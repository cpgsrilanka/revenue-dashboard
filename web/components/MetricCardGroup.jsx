function numberValue(value) {
  return Number(value || 0);
}

function formatValue(item, currency = "LKR") {
  if (item.format === "number") {
    return new Intl.NumberFormat("en-LK", {
      maximumFractionDigits: item.maximumFractionDigits ?? 0,
    }).format(numberValue(item.value));
  }

  if (item.format === "percent") {
    return `${numberValue(item.value).toFixed(item.maximumFractionDigits ?? 1)}%`;
  }

  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency,
    notation: item.notation || "compact",
    maximumFractionDigits: item.maximumFractionDigits ?? 1,
  }).format(numberValue(item.value));
}

export default function MetricCardGroup({ eyebrow, title, caption, items, currency = "LKR", className = "" }) {
  if (!items?.length) return null;

  return (
    <section className={`mb-8 ${className}`}>
      <div className="mb-3">
        {eyebrow && <p className="text-xs uppercase tracking-wide text-slate">{eyebrow}</p>}
        {title && <h2 className="font-display text-2xl">{title}</h2>}
        {caption && <p className="mt-1 text-xs text-slate">{caption}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px border border-line rounded-lg overflow-hidden bg-line">
        {items.map((item) => (
          <div key={item.label} className="bg-white/60 px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-slate">{item.label}</p>
            <p
              className={`font-display text-2xl mt-1 tabular-nums ${
                item.intent === "bad" ? "text-brick" : item.intent === "good" ? "text-brass" : ""
              }`}
            >
              {formatValue(item, item.currency || currency)}
            </p>
            {item.note && <p className="mt-1 text-xs text-slate">{item.note}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
