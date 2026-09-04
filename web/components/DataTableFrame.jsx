export default function DataTableFrame({ children, className = "" }) {
  return (
    <div className={`overflow-hidden rounded-lg border border-line bg-white/55 ${className}`}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
