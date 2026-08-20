const SEVERITY_STYLES = {
  critical: "bg-brick/10 text-brick",
  warning: "bg-amberflag/10 text-amberflag",
  info: "bg-slate/10 text-slate"
};

function timeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const hours = Math.round(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function DataHealthPanel({ findings }) {
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warning = findings.filter((f) => f.severity === "warning").length;

  return (
    <div className="border border-line rounded-xl p-5 bg-white/40">
      <div className="flex items-center justify-between mb-4">
        <p className="font-medium text-ink">Data health</p>
        <span className="text-xs text-slate">
          {findings.length === 0
            ? "No open findings"
            : `${critical} critical, ${warning} warning`}
        </span>
      </div>

      {findings.length === 0 ? (
        <p className="text-sm text-slate">
          All properties ingested cleanly. No open data quality findings.
        </p>
      ) : (
        <ul className="space-y-2">
          {findings.map((finding) => (
            <li key={finding.id} className="flex items-start gap-3 text-sm">
              <span
                className={`shrink-0 mt-0.5 text-xs px-2 py-0.5 rounded-full font-medium ${
                  SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.info
                }`}
              >
                {finding.severity}
              </span>
              <span className="flex-1">
                <span className="font-medium text-ink">{finding.property_code}</span>{" "}
                <span className="text-slate">{finding.message}</span>
              </span>
              <span className="shrink-0 text-xs text-slate tabular-nums">
                {timeAgo(finding.detected_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
