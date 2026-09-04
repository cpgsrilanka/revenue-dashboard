export function canonicalSegment(value) {
  const raw = String(value || "").trim();
  const key = raw.toLowerCase().replace(/\s+/g, " ");

  if (!key || key === "unassigned" || key === "(blank)") return "No segment entered";
  if (["foreign", "fit foreign", "fit-foreign", "fit - foreign"].includes(key)) return "FIT - Foreign";
  if (["local", "fit local", "fit-local", "fit - local"].includes(key)) return "FIT - Local";
  if (key === "owners") return "Owner";

  return raw;
}

export function isTotalSegment(value) {
  return ["total", "grand total"].includes(String(value || "").trim().toLowerCase());
}
