export default function SectionHeader({ eyebrow, title, subtitle, action }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-4">
      <div>
        {eyebrow && <p className="text-xs uppercase tracking-wide text-slate">{eyebrow}</p>}
        {title && <h2 className="font-display text-2xl">{title}</h2>}
        {subtitle && <p className="mt-1 text-xs leading-5 text-slate">{subtitle}</p>}
      </div>
      {action && <div className="text-xs text-slate sm:text-right">{action}</div>}
    </div>
  );
}
