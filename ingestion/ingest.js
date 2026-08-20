import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import yaml from "js-yaml";

import { buildGraphClient, listPropertyFiles, downloadFile, sendMail } from "./graphClient.js";
import { parsePropertyWorkbook } from "./parseExcel.js";
import { runQualityChecks } from "./qualityChecks.js";
import { shouldSendAlert, buildSummaryEmail } from "./alerting.js";

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

  console.log("\n=== Ingestion summary ===");
  for (const p of summary.properties) {
    console.log(
      `${p.propertyCode}: ${p.status}` +
        (p.filesProcessed !== undefined ? ` — ${p.filesProcessed} file(s), ${p.rowsIngested ?? 0} rows, ${p.findingsCount ?? 0} quality finding(s)` : "")
    );
  }

  const anyCritical = summary.properties.some((p) => p.hasCriticalFindings);
  if (anyCritical) {
    console.log("\n⚠️  One or more properties have CRITICAL data quality findings — review data_quality_log before trusting the dashboard totals.");
  }

  await sendAlertIfNeeded(graphClient, summary);
}

async function sendAlertIfNeeded(graphClient, summary) {
  if (!shouldSendAlert(summary)) {
    console.log("\nNo alert-worthy findings this run — skipping email (set ALERT_ALWAYS=true in .env to always send a nightly summary).");
    return;
  }

  const { subject, html } = buildSummaryEmail(summary, { dryRun: DRY_RUN });

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would send alert email: "${subject}"`);
    return;
  }

  if (!process.env.ALERT_EMAIL_FROM || !process.env.ALERT_EMAIL_TO) {
    console.log(
      "\n⚠️  This run has alert-worthy findings, but ALERT_EMAIL_FROM/ALERT_EMAIL_TO aren't set in .env — skipping email. " +
        "Set both (see .env.example) to enable the nightly alert."
    );
    return;
  }

  try {
    await sendMail(graphClient, {
      from: process.env.ALERT_EMAIL_FROM,
      to: process.env.ALERT_EMAIL_TO,
      subject,
      html,
    });
    console.log(`\nAlert email sent to ${process.env.ALERT_EMAIL_TO}: "${subject}"`);
  } catch (err) {
    // A failed alert shouldn't fail the whole ingestion run — the data's
    // already written (or dry-run validated); just surface it loudly.
    console.error("Failed to send alert email:", err.message);
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
    const message = `Could not search SharePoint for files matching "${filenameMatch}": ${err.message}`;
    await logQualityFinding({
      property_code: propertyCode,
      check_type: "completeness",
      severity: "critical",
      message,
    });
    return { propertyCode, status: "sharepoint_error", hasCriticalFindings: true, criticalFindings: [message] };
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

  let totalRows = 0;
  let totalFindings = 0;
  let hasCritical = false;
  let filesProcessed = 0;
  const criticalFindings = [];

  for (const file of files) {
    // Idempotency: skip files we've already ingested with this exact content
    const buffer = await downloadFile(file.downloadUrl);
    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

    const { data: existing } = await supabase
      .from("ingestion_log")
      .select("id")
      .eq("property_code", propertyCode)
      .eq("file_name", file.name)
      .eq("file_hash", fileHash)
      .maybeSingle();

    if (existing) {
      console.log(`${propertyCode}: "${file.name}" already ingested (unchanged), skipping.`);
      continue;
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
    criticalFindings.push(
      ...findings.filter((f) => f.severity === "critical").map((f) => `${file.name}: ${f.message}`)
    );

    if (DRY_RUN) {
      console.log(
        `[DRY RUN] ${propertyCode} / ${file.name}: would ingest ${cleanRows.length} rows, ` +
          `${parseErrors.length} parse errors, ${findings.length} quality findings.`
      );
      filesProcessed++;
      totalRows += cleanRows.length;
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
    if (cleanRows.length > 0) {
      const { error: cleanError } = await supabase.from("clean_reservations").upsert(
        cleanRows.map((r) => ({ ...r.data })),
        { onConflict: "property_code,reservation_id" }
      );
      if (cleanError) throw cleanError;
    }

    // 4. Log quality findings
    if (findings.length > 0) {
      const { error: findingsError } = await supabase.from("data_quality_log").insert(findings);
      if (findingsError) throw findingsError;
    }

    filesProcessed++;
    totalRows += cleanRows.length;
  }

  return {
    propertyCode,
    status: "ok",
    filesProcessed,
    rowsIngested: totalRows,
    findingsCount: totalFindings,
    hasCriticalFindings: hasCritical,
    criticalFindings,
  };
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
