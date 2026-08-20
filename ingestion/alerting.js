// Nightly ingestion alert — summarizes ingest.js's run and decides whether
// it's worth emailing. Kept separate from ingest.js (pure functions, no
// Graph/network calls) so the decision and formatting logic can be unit
// tested the same way qualityChecks.js is — see test-alerting.mjs.

/**
 * Decide whether this run's summary is worth sending as an email.
 * By default only sends when something needs a human's attention, so a
 * clean run doesn't generate nightly noise. Set ALERT_ALWAYS=true in .env
 * to get a summary every run regardless (the "nightly summary" behavior
 * the README originally described).
 */
export function shouldSendAlert(summary, env = process.env) {
  if (env.ALERT_ALWAYS === "true") return true;
  return summary.properties.some(needsAttention);
}

function needsAttention(property) {
  return (
    property.hasCriticalFindings ||
    property.status === "sharepoint_error" ||
    property.status === "skipped_no_config"
  );
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Builds the subject + HTML body for the summary email from the same
 * `summary` object ingest.js already logs to the console.
 */
export function buildSummaryEmail(summary, { dryRun = false } = {}) {
  const flagged = summary.properties.filter(needsAttention);

  const subject = flagged.length > 0
    ? `⚠️ Revenue dashboard ingestion — ${flagged.length} propert${flagged.length === 1 ? "y needs" : "ies need"} attention${dryRun ? " (dry run)" : ""}`
    : `Revenue dashboard ingestion — nightly summary, all clear${dryRun ? " (dry run)" : ""}`;

  const rows = summary.properties
    .map((p) => {
      const flag = needsAttention(p) ? "🔴" : "🟢";
      const detail = p.filesProcessed !== undefined
        ? `${p.filesProcessed} file(s), ${p.rowsIngested ?? 0} rows, ${p.findingsCount ?? 0} finding(s)`
        : "—";
      return `<tr>
        <td style="padding:4px 10px;">${flag} ${escapeHtml(p.propertyCode)}</td>
        <td style="padding:4px 10px;">${escapeHtml(p.status)}</td>
        <td style="padding:4px 10px;">${escapeHtml(detail)}</td>
      </tr>`;
    })
    .join("\n");

  const criticalItems = summary.properties
    .flatMap((p) => (p.criticalFindings || []).map((msg) => `<li>${escapeHtml(msg)}</li>`))
    .join("\n");

  const html = `
    <h2 style="font-family:sans-serif;">Revenue dashboard — nightly ingestion summary</h2>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:13px;">
      <tr style="text-align:left;border-bottom:1px solid #ccc;">
        <th style="padding:4px 10px;">Property</th>
        <th style="padding:4px 10px;">Status</th>
        <th style="padding:4px 10px;">Detail</th>
      </tr>
      ${rows}
    </table>
    ${criticalItems ? `<h3 style="font-family:sans-serif;">Critical findings</h3><ul style="font-family:sans-serif;font-size:13px;">${criticalItems}</ul>` : ""}
    <p style="color:#666;font-size:12px;font-family:sans-serif;">
      Full detail in Supabase's <code>data_quality_log</code> table, or the dashboard's Data Health panel.
    </p>
  `;

  return { subject, html };
}
