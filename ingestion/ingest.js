import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import yaml from "js-yaml";

import { buildGraphClient, listPropertyFiles, downloadFile } from "./graphClient.js";
import { parsePropertyWorkbook } from "./parseExcel.js";
import { parsePmsExport } from "./parsePmsExport.js";
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

  const pms = config.pms?.enabled ? config.pms : null;
  const sourceLabel = pms ? `${pms.adapter} PMS export` : "legacy workbook";
  const sourceFilenameMatch = pms?.filename_match || filenameMatch;

  if (pms && !DRY_RUN && pms.replace_legacy_clean_rows !== true) {
    throw new Error(
      `${propertyCode}: PMS adapter is enabled, but replace_legacy_clean_rows is not true. ` +
        "Run a dry run first, reconcile it, then explicitly approve the clean-row cutover."
    );
  }

  let files;
  try {
    files = await listPropertyFiles(graphClient, driveId, sourceFilenameMatch, pms ? {
      folders: pms.folders,
      extensions: pms.extensions,
    } : undefined);
  } catch (err) {
    console.error(`Failed to list files for ${propertyCode}: ${err.message}`);
    await logQualityFinding({
      property_code: propertyCode,
      check_type: "completeness",
      severity: "critical",
      message: `Could not search SharePoint for ${sourceLabel} files matching "${sourceFilenameMatch}": ${err.message}`,
    });
    return { propertyCode, status: "sharepoint_error", hasCriticalFindings: true };
  }

  if (files.length === 0) {
    await logQualityFinding({
      property_code: propertyCode,
      check_type: "completeness",
      severity: "warning",
      message: `No ${sourceLabel} files found matching "${sourceFilenameMatch}".`,
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
    const { budgetRows, budgetWarnings, matrixRows, matrixWarnings } = pms
      ? { budgetRows: [], budgetWarnings: [], matrixRows: [], matrixWarnings: [] }
      : (() => {
          const budget = parseBudgetRows(buffer, propertyCode, config.currency);
          const matrix = parseReportMatrixRows(buffer, propertyCode, config.currency);
          return {
            budgetRows: budget.budgetRows,
            budgetWarnings: budget.warnings,
            matrixRows: matrix.matrixRows,
            matrixWarnings: matrix.warnings,
          };
        })();

    for (const warning of budgetWarnings) {
      console.warn(`${propertyCode}: budget warning - ${warning}`);
    }
    for (const warning of matrixWarnings) {
      console.warn(`${propertyCode}: matrix warning - ${warning}`);
    }

    const { rawRows, cleanRows, parseErrors } = pms
      ? parsePmsExport(buffer, propertyCode, config)
      : parsePropertyWorkbook(buffer, propertyCode, config);
    const cleanRowsWithSnapshot = pms
      ? cleanRows.map((row) => ({
          ...row,
          data: { ...row.data, source_snapshot_id: fileHash },
        }))
      : cleanRows;

    const { data: prevLog } = await supabase
      .from("ingestion_log")
      .select("row_count")
      .eq("property_code", propertyCode)
      .order("ingested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const findings = runQualityChecks({
      propertyCode,
      cleanRows: cleanRowsWithSnapshot,
      parseErrors,
      previousFileRowCount: prevLog?.row_count,
      requireTotalRevenue: pms?.require_total_revenue !== false,
    });

    hasCritical = hasCritical || findings.some((f) => f.severity === "critical");
    totalFindings += findings.length;

    const cleanRowsToStore = cleanRowsWithSnapshot.filter(
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
        if (pms && !hasCritical) {
          await removeStalePmsRows(propertyCode, pms.adapter, fileHash);
          await removeLegacyCleanRows(propertyCode);
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

    if (pms && !hasCritical) {
      await removeStalePmsRows(propertyCode, pms.adapter, fileHash);
      await removeLegacyCleanRows(propertyCode);
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
  const usesSourceKey = rows.every((row) => row.source_system && row.source_record_id);
  const conflictColumns = usesSourceKey
    ? ["property_code", "source_system", "source_record_id"]
    : [
        "property_code",
        "reservation_id",
        "guest_arrival_date",
        "guest_departure_date",
        "total_revenue",
      ];
  const uniqueRows = dedupeForUpsert(rows, conflictColumns, "clean reservation");
  const options = {
    onConflict: usesSourceKey
      ? "property_code,source_system,source_record_id"
      : "property_code,reservation_id,guest_arrival_date,guest_departure_date,total_revenue",
  };
  const { error } = await supabase.from("clean_reservations").upsert(uniqueRows, options);
  if (!error) return;

  if (usesSourceKey && /source_system|source_record_id|ON CONFLICT/i.test(error.message || "")) {
    throw new Error(
      "PMS source columns are not active in Supabase. Run db/pms-source-adapters-upgrade.sql before enabling this PMS adapter."
    );
  }

  if (error.message?.includes("'segment' column")) {
    console.warn(
      "Segment tracking is not active yet. Run db/dashboard-matrix-upgrade.sql in Supabase, then run ingestion again."
    );
    const rowsWithoutSegment = uniqueRows.map(({ segment, ...row }) => row);
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
    const rowsWithoutPickupDate = uniqueRows.map(({ pickup_date, ...row }) => row);
    const { error: retryError } = await supabase
      .from("clean_reservations")
      .upsert(rowsWithoutPickupDate, options);
    if (retryError) throw retryError;
    return;
  }

  throw error;
}

async function removeStalePmsRows(propertyCode, adapter, snapshotId) {
  const sourceSystem = adapter.replace(/_xlsx$|_xml$/, "");
  const { error } = await supabase
    .from("clean_reservations")
    .delete()
    .eq("property_code", propertyCode)
    .eq("source_system", sourceSystem)
    .neq("source_snapshot_id", snapshotId);

  if (error) throw error;
}

async function removeLegacyCleanRows(propertyCode) {
  const { error } = await supabase
    .from("clean_reservations")
    .delete()
    .eq("property_code", propertyCode)
    .eq("source_system", "legacy_excel");

  if (error) throw error;
}

async function upsertBudgets(budgetRows) {
  if (!budgetRows.length) return;

  const uniqueRows = dedupeForUpsert(budgetRows, ["property_code", "period_month"], "budget");
  const { error } = await supabase.from("budget").upsert(uniqueRows, {
    onConflict: "property_code,period_month",
  });
  if (error) throw error;
}

async function upsertReportMatrixRows(matrixRows) {
  if (!matrixRows.length) return;

  const uniqueRows = dedupeForUpsert(
    matrixRows,
    ["property_code", "period_month", "segment"],
    "monthly segment"
  );
  const { error } = await supabase.from("monthly_segment_report").upsert(uniqueRows, {
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

function dedupeForUpsert(rows, conflictColumns, label) {
  const rowsByKey = new Map();
  let duplicateCount = 0;

  for (const row of rows) {
    const key = JSON.stringify(conflictColumns.map((column) => row[column] ?? null));
    if (rowsByKey.has(key)) duplicateCount++;
    rowsByKey.set(key, row);
  }

  if (duplicateCount > 0) {
    console.warn(
      `Collapsed ${duplicateCount} repeated ${label} row(s) before database upsert; the last source row was retained.`
    );
  }

  return [...rowsByKey.values()];
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
