import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import yaml from "js-yaml";

import { buildGraphClient, listPropertyFiles, downloadFile } from "./graphClient.js";
import { parsePropertyWorkbook } from "./parseExcel.js";
import { parseBudgetRows } from "./parseBudget.js";
import { parseReportMatrixRows } from "./parseReportMatrix.js";
import { runQualityChecks } from "./qualityChecks.js";

const DRY_RUN = process.argv.includes("--dry-run");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const propertyConfigs = yaml.load(fs.readFileSync(new URL("../config/properties.yaml", import.meta.url), "utf8")).properties;

async function main() {
  console.log(`Starting ingestion run${DRY_RUN ? " (DRY RUN — no writes)" : ""}...`);

  const graphClient = buildGraphClient();
  const driveId = process.env.SHAREPOINT_DRIVE_ID;

  const { data: properties, error: propError } = await supabase
    .from("property_master")
    .select("property_code, sharepoint_filename_match")
    .eq("active", true);

  if (propError) throw propError;

  const summary = { properties: [] };

  for (const property of properties) {
    const propertySummary = await ingestProperty(graphClient, driveId, property);
    summary.properties.push(propertySummary);
  }

  if (!DRY_RUN) {
    const snapshotRows = await refreshRevenueSnapshots();
    if (snapshotRows > 0) {
      console.log(`Revenue snapshots refreshed: ${snapshotRows} property/month row(s).`);
    }
  }

  console.log("\n=== Ingestion summary ===");
  for (const p of summary.properties) {
    console.log(
      `${p.propertyCode}: ${p.status}` +
        (p.filesProcessed !== undefined
          ? ` — ${p.filesProcessed} file(s), ${p.rowsIngested ?? 0} rows, ${p.budgetMonths ?? 0} budget month(s), ${p.matrixRows ?? 0} matrix row(s), ${p.findingsCount ?? 0} quality finding(s)`
          : "")
    );
  }

  const anyCritical = summary.properties.some((p) => p.hasCriticalFindings);
  if (anyCritical) {
    console.log("\n⚠️  One or more properties have CRITICAL data quality findings — review data_quality_log before trusting the dashboard totals.");
    // TODO: wire this into a Teams/Outlook alert (Microsoft 365 connector) once
    // the pipeline is stable — see plan Section 5 "Alerting".
  }
}

async function ingestProperty(graphClient, driveId, property) {
  const { property_code: propertyCode, sharepoint_filename_match: filenameMatch } = property;
  const config = propertyConfigs[propertyCode];

  if (!config) {
    console.warn(`No adapter config found for ${propertyCode} in config/properties.yaml — skipping.`);
    return { propertyCode, status: "skipped_no_config" };
  }

  let files;
  try {
    files = await listPropertyFiles(graphClient, driveId, filenameMatch);
  } catch (err) {
    console.error(`Failed to list files for ${propertyCode}: ${err.message}`);
    await logQualityFinding({
      property_code: propertyCode,
      check_type: "completeness",
      severity: "critical",
      message: `Could not search SharePoint for files matching "${filenameMatch}": ${err.message}`,
    });
    return { propertyCode, status: "sharepoint_error", hasCriticalFindings: true };
  }

  if (files.length === 0) {
    await logQualityFinding({
      property_code: propertyCode,
      check_type: "completeness",
      severity: "warning",
      message: `No .xlsx files found matching "${filenameMatch}" in any known Databases/FY folder.`,
    });
    return { propertyCode, status: "no_files_found", filesProcessed: 0 };
  }

  files = files.slice(0, 1);

  let totalRows = 0;
  let totalFindings = 0;
  let totalBudgetMonths = 0;
  let totalMatrixRows = 0;
  let hasCritical = false;
  let filesProcessed = 0;

  for (const file of files) {
    // Idempotency: skip files we've already ingested with this exact content
    const buffer = await downloadFile(file.downloadUrl);
    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
    const { budgetRows, warnings: budgetWarnings } = parseBudgetRows(
      buffer,
      propertyCode,
      config.currency
    );
    const { matrixRows, warnings: matrixWarnings } = parseReportMatrixRows(
      buffer,
      propertyCode,
      config.currency
    );

    for (const warning of budgetWarnings) {
      console.warn(`${propertyCode}: budget warning - ${warning}`);
    }
    for (const warning of matrixWarnings) {
      console.warn(`${propertyCode}: matrix warning - ${warning}`);
    }

    const { rawRows, cleanRows, parseErrors } = parsePropertyWorkbook(buffer, propertyCode, config);

    const { data: prevLog } = await supabase
      .from("ingestion_log")
      .select("row_count")
      .eq("property_code", propertyCode)
      .order("ingested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const findings = runQualityChecks({
      propertyCode,
      cleanRows,
      parseErrors,
      previousFileRowCount: prevLog?.row_count,
    });

    hasCritical = hasCritical || findings.some((f) => f.severity === "critical");
    totalFindings += findings.length;

    const cleanRowsToStore = cleanRows.filter(
      (r) => r.data.quarantine_reason !== "duplicate_row_in_file"
    );

    const { data: existing } = await supabase
      .from("ingestion_log")
      .select("id")
      .eq("property_code", propertyCode)
      .eq("file_name", file.name)
      .eq("file_hash", fileHash)
      .maybeSingle();

    if (existing) {
      if (!DRY_RUN) {
        if (cleanRowsToStore.length > 0) {
          await upsertCleanRows(cleanRowsToStore.map((r) => ({ ...r.data })));
        }
        await upsertBudgets(budgetRows);
        await upsertReportMatrixRows(matrixRows);
      }
      console.log(
        `${propertyCode}: "${file.name}" already ingested (unchanged), refreshed ${cleanRowsToStore.length} clean booking row(s), ${budgetRows.length} budget month(s), ${matrixRows.length} matrix row(s).`
      );
      filesProcessed++;
      totalRows += cleanRows.length;
      totalBudgetMonths += budgetRows.length;
      totalMatrixRows += matrixRows.length;
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `[DRY RUN] ${propertyCode} / ${file.name}: would ingest ${cleanRows.length} rows, ` +
          `${budgetRows.length} budget month(s), ${parseErrors.length} parse errors, ${findings.length} quality findings.`
      );
      filesProcessed++;
      totalRows += cleanRows.length;
      totalBudgetMonths += budgetRows.length;
      totalMatrixRows += matrixRows.length;
      continue;
    }

    // 1. Log the ingestion attempt
    const { data: logEntry, error: logError } = await supabase
      .from("ingestion_log")
      .insert({
        property_code: propertyCode,
        file_name: file.name,
        file_hash: fileHash,
        sharepoint_modified_at: file.lastModifiedDateTime,
        row_count: cleanRows.length,
        status: parseErrors.length > 0 ? "partial" : "success",
        error_message: parseErrors.length > 0 ? `${parseErrors.length} row(s) failed to parse` : null,
      })
      .select("id")
      .single();

    if (logError) throw logError;

    // 2. Insert raw rows (JSONB, untouched)
    if (rawRows.length > 0) {
      const { error: rawError } = await supabase.from("raw_reservations").insert(
        rawRows.map((r) => ({
          property_code: propertyCode,
          ingestion_log_id: logEntry.id,
          source_file: file.name,
          source_row_number: r.sourceRowNumber,
          raw_row: r.data,
        }))
      );
      if (rawError) throw rawError;
    }

    // 3. Upsert clean rows (unified schema)
    if (cleanRowsToStore.length > 0) {
      await upsertCleanRows(cleanRowsToStore.map((r) => ({ ...r.data })));
    }

    // 4. Upsert budget rows from the same workbook's revenue pickup report
    await upsertBudgets(budgetRows);
    await upsertReportMatrixRows(matrixRows);

    // 5. Log quality findings
    if (findings.length > 0) {
      const { error: findingsError } = await supabase.from("data_quality_log").insert(findings);
      if (findingsError) throw findingsError;
    }

    filesProcessed++;
    totalRows += cleanRows.length;
    totalBudgetMonths += budgetRows.length;
    totalMatrixRows += matrixRows.length;
  }

  return {
    propertyCode,
    status: "ok",
    filesProcessed,
    rowsIngested: totalRows,
    budgetMonths: totalBudgetMonths,
    matrixRows: totalMatrixRows,
    findingsCount: totalFindings,
    hasCriticalFindings: hasCritical,
  };
}

async function upsertCleanRows(rows) {
  const options = {
    onConflict:
      "property_code,reservation_id,guest_arrival_date,guest_departure_date,total_revenue",
  };
  const { error } = await supabase.from("clean_reservations").upsert(rows, options);
  if (!error) return;

  if (error.message?.includes("'segment' column")) {
    console.warn(
      "Segment tracking is not active yet. Run db/dashboard-matrix-upgrade.sql in Supabase, then run ingestion again."
    );
    const rowsWithoutSegment = rows.map(({ segment, ...row }) => row);
    const { error: retryError } = await supabase
      .from("clean_reservations")
      .upsert(rowsWithoutSegment, options);
    if (retryError) throw retryError;
    return;
  }

  if (error.message?.includes("'pickup_date' column")) {
    console.warn(
      "Pickup-date basis is not active yet. Run db/pickup-date-basis.sql in Supabase, then run ingestion again."
    );
    const rowsWithoutPickupDate = rows.map(({ pickup_date, ...row }) => row);
    const { error: retryError } = await supabase
      .from("clean_reservations")
      .upsert(rowsWithoutPickupDate, options);
    if (retryError) throw retryError;
    return;
  }

  throw error;
}

async function upsertBudgets(budgetRows) {
  if (!budgetRows.length) return;

  const { error } = await supabase.from("budget").upsert(budgetRows, {
    onConflict: "property_code,period_month",
  });
  if (error) throw error;
}

async function upsertReportMatrixRows(matrixRows) {
  if (!matrixRows.length) return;

  const { error } = await supabase.from("monthly_segment_report").upsert(matrixRows, {
    onConflict: "property_code,period_month,segment",
  });
  if (!error) return;

  if (error.message?.includes("monthly_segment_report")) {
    console.warn(
      "Dashboard matrix table is not active yet. Run db/dashboard-matrix-upgrade.sql in Supabase, then run ingestion again."
    );
    return;
  }

  throw error;
}

async function refreshRevenueSnapshots() {
  const { data, error } = await supabase
    .from("v_monthly_revenue")
    .select("property_code,period_month,actual_revenue,reservation_count,currency");

  if (error) {
    console.warn(`Could not read monthly revenue for snapshots: ${error.message}`);
    return 0;
  }

  const snapshotSourceRows = (data || []).filter((row) => row.period_month);
  if (!snapshotSourceRows.length) return 0;

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const rows = snapshotSourceRows.map((row) => ({
    property_code: row.property_code,
    snapshot_date: snapshotDate,
    period_month: row.period_month,
    actual_revenue: row.actual_revenue || 0,
    reservation_count: row.reservation_count || 0,
    currency: row.currency || "LKR",
    updated_at: new Date().toISOString(),
  }));

  const { error: snapshotError } = await supabase.from("revenue_snapshot").upsert(rows, {
    onConflict: "property_code,snapshot_date,period_month",
  });

  if (snapshotError) {
    console.warn(
      `Daily pickup snapshots are not active yet. Run db/revenue-snapshots.sql in Supabase, then run ingestion again. (${snapshotError.message})`
    );
    return 0;
  }

  return rows.length;
}

async function logQualityFinding(finding) {
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would log finding:`, finding);
    return;
  }
  const { error } = await supabase.from("data_quality_log").insert(finding);
  if (error) console.error("Failed to log quality finding:", error.message);
}

main().catch((err) => {
  console.error("Ingestion run failed:", err);
  process.exit(1);
});
