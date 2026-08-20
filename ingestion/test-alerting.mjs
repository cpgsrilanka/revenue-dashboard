import { shouldSendAlert, buildSummaryEmail } from "./alerting.js";

const cleanRun = {
  properties: [
    { propertyCode: "CRS", status: "ok", filesProcessed: 1, rowsIngested: 214, findingsCount: 0, hasCriticalFindings: false, criticalFindings: [] },
    { propertyCode: "SIX", status: "ok", filesProcessed: 1, rowsIngested: 132, findingsCount: 1, hasCriticalFindings: false, criticalFindings: [] },
  ],
};

const criticalRun = {
  properties: [
    { propertyCode: "CRS", status: "ok", filesProcessed: 1, rowsIngested: 214, findingsCount: 0, hasCriticalFindings: false, criticalFindings: [] },
    {
      propertyCode: "LYN",
      status: "ok",
      filesProcessed: 1,
      rowsIngested: 40,
      findingsCount: 2,
      hasCriticalFindings: true,
      criticalFindings: ["Leyn Baan Database (26-27).xlsx: Negative total_revenue value: -500."],
    },
  ],
};

const sharepointErrorRun = {
  properties: [
    { propertyCode: "ASM", status: "sharepoint_error", hasCriticalFindings: true, criticalFindings: ["Could not search SharePoint for files matching \"Asaya Sands Database\": 403 Forbidden"] },
  ],
};

const checks = [
  [shouldSendAlert(cleanRun, {}) === false, "a clean run with no critical findings should NOT trigger an alert by default"],
  [shouldSendAlert(criticalRun, {}) === true, "a run with a critical finding SHOULD trigger an alert"],
  [shouldSendAlert(sharepointErrorRun, {}) === true, "a SharePoint access error SHOULD trigger an alert (it's not just a data-quality finding)"],
  [shouldSendAlert(cleanRun, { ALERT_ALWAYS: "true" }) === true, "ALERT_ALWAYS=true should force an alert even on a clean run"],
];

const cleanEmail = buildSummaryEmail(cleanRun);
checks.push([
  cleanEmail.subject.includes("all clear"),
  "a clean run's subject line should say all clear",
]);

const criticalEmail = buildSummaryEmail(criticalRun);
checks.push([
  criticalEmail.subject.includes("1 property needs attention"),
  "a single flagged property should be singular in the subject line",
]);
checks.push([
  criticalEmail.html.includes("Negative total_revenue value: -500"),
  "the critical finding's message should appear in the email body",
]);

const dryRunEmail = buildSummaryEmail(criticalRun, { dryRun: true });
checks.push([
  dryRunEmail.subject.includes("(dry run)"),
  "a dry-run summary's subject should be labeled as a dry run",
]);

// HTML-escaping: a finding message containing markup shouldn't break the email
const xssRun = {
  properties: [
    {
      propertyCode: "CRS",
      status: "ok",
      hasCriticalFindings: true,
      criticalFindings: ["<script>alert(1)</script> & other stuff"],
    },
  ],
};
const xssEmail = buildSummaryEmail(xssRun);
checks.push([
  !xssEmail.html.includes("<script>alert(1)</script>") && xssEmail.html.includes("&lt;script&gt;"),
  "finding messages should be HTML-escaped in the email body",
]);

const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  console.error("FAILED:");
  failed.forEach(([, msg]) => console.error(" -", msg));
  process.exit(1);
}
console.log("All checks passed.");
