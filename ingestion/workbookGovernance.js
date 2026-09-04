import "dotenv/config";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { buildGraphClient, listPropertyFiles, downloadFile } from "./graphClient.js";
import { parsePropertyWorkbook } from "./parseExcel.js";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const ACCEPT_OPENPYXL_REWRITE_RISK = process.argv.includes("--accept-openpyxl-rewrite-risk");
const PROPERTY_ARG = readArg("--property");
const PYTHON_BIN =
  process.env.PYTHON_BIN ||
  "/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";

const propertyConfigs = yaml.load(
  fs.readFileSync(new URL("../config/properties.yaml", import.meta.url), "utf8")
).properties;

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function safeName(name) {
  return name.replace(/[^\w.-]+/g, "_");
}

async function main() {
  if (APPLY && !ACCEPT_OPENPYXL_REWRITE_RISK) {
    throw new Error(
      "Apply mode is blocked by default because rewriting whole Excel files can remove Excel Online-only features like slicers. " +
        "Review the local standardized copies first, then rerun with --apply --accept-openpyxl-rewrite-risk if replacing the live files is acceptable."
    );
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(__dirname, "governance-runs", runId);
  const backupDir = path.join(runDir, "backups");
  const outputDir = path.join(runDir, "standardized");
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const graphClient = buildGraphClient();
  const driveId = process.env.SHAREPOINT_DRIVE_ID;

  let query = supabase
    .from("property_master")
    .select("property_code, sharepoint_filename_match")
    .eq("active", true)
    .order("property_code");

  if (PROPERTY_ARG) query = query.eq("property_code", PROPERTY_ARG);

  const { data: properties, error } = await query;
  if (error) throw error;
  if (!properties?.length) throw new Error("No active properties found to standardize.");

  const summary = [];

  for (const property of properties) {
    let result;
    try {
      result = await standardizeProperty({ graphClient, driveId, property, backupDir, outputDir });
    } catch (err) {
      result = {
        propertyCode: property.property_code,
        status: "failed",
        fileName: property.sharepoint_filename_match,
        cleanRows: 0,
        parseErrors: 0,
        uploaded: false,
        error: err.message,
      };
      console.error(`${property.property_code}: ${err.message}`);
    }
    summary.push(result);
  }

  const summaryPath = path.join(runDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify({ mode: APPLY ? "apply" : "dry-run", summary }, null, 2));

  console.log(`\nWorkbook governance ${APPLY ? "applied" : "dry-run completed"}.`);
  console.log(`Run folder: ${runDir}`);
  for (const item of summary) {
    console.log(
      `${item.propertyCode}: ${item.status} — ${item.fileName}` +
        (item.uploaded ? " (uploaded to SharePoint)" : " (local standardized copy only)") +
        `, ${item.cleanRows} dashboard row(s), ${item.parseErrors} parse error(s)`
    );
  }
}

async function standardizeProperty({ graphClient, driveId, property, backupDir, outputDir }) {
  const propertyCode = property.property_code;
  const config = propertyConfigs[propertyCode];
  if (!config) {
    return {
      propertyCode,
      status: "skipped_no_config",
      fileName: "",
      cleanRows: 0,
      parseErrors: 0,
      uploaded: false,
    };
  }

  const files = await withRetry(
    () => listPropertyFiles(graphClient, driveId, property.sharepoint_filename_match),
    `${propertyCode}: list SharePoint files`
  );
  if (!files.length) {
    return {
      propertyCode,
      status: "no_file_found",
      fileName: property.sharepoint_filename_match,
      cleanRows: 0,
      parseErrors: 0,
      uploaded: false,
    };
  }

  const file = files[0];
  console.log(`${propertyCode}: standardizing "${file.name}"...`);
  const buffer = await withRetry(
    () => downloadFile(file.downloadUrl),
    `${propertyCode}: download ${file.name}`
  );
  const beforeHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const backupPath = path.join(backupDir, `${propertyCode}-${safeName(file.name)}`);
  const standardizedPath = path.join(outputDir, `${propertyCode}-${safeName(file.name)}`);
  const reportPath = path.join(outputDir, `${propertyCode}-standardization-report.json`);

  fs.writeFileSync(backupPath, buffer);

  const python = spawnSync(
    PYTHON_BIN,
    [
      path.join(__dirname, "standardizeWorkbook.py"),
      "--input",
      backupPath,
      "--output",
      standardizedPath,
      "--property",
      propertyCode,
      "--report",
      reportPath,
    ],
    { encoding: "utf8" }
  );

  if (python.status !== 0) {
    throw new Error(
      `${propertyCode}: workbook standardization failed:\n${python.stdout}\n${python.stderr}`
    );
  }

  const standardizedBuffer = fs.readFileSync(standardizedPath);
  const afterHash = crypto.createHash("sha256").update(standardizedBuffer).digest("hex");
  const { cleanRows, parseErrors } = parsePropertyWorkbook(standardizedBuffer, propertyCode, config);

  if (cleanRows.length === 0) {
    throw new Error(`${propertyCode}: standardized workbook parsed 0 dashboard rows; refusing to continue.`);
  }

  let uploaded = false;
  if (APPLY && beforeHash !== afterHash) {
    await graphClient.api(`/drives/${driveId}/items/${file.id}/content`).put(standardizedBuffer);
    uploaded = true;
  }

  return {
    propertyCode,
    fileName: file.name,
    itemId: file.id,
    backupPath,
    standardizedPath,
    standardizationReportPath: reportPath,
    status: beforeHash === afterHash ? "already_standardized" : "standardized",
    cleanRows: cleanRows.length,
    parseErrors: parseErrors.length,
    uploaded,
  };
}

async function withRetry(fn, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        console.warn(`${label} failed (${err.message}); retrying ${attempt + 1}/${attempts}...`);
        await sleep(1500 * attempt);
      }
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
