import { runQualityChecks } from "./qualityChecks.js";

function row(overrides) {
  return {
    data: {
      reservation_id: "600251093",
      guest_arrival_date: "2026-04-03",
      guest_departure_date: "2026-04-06",
      total_revenue: 1354050,
      status: "confirmed",
      is_quarantined: false,
      ...overrides,
    },
  };
}

// Case 1: multi-villa booking — same ID, same dates, DIFFERENT revenue per villa. Should NOT be flagged.
const multiVilla = [
  row({ reservation_id: "600463763", total_revenue: 0 }),
  row({ reservation_id: "600463763", total_revenue: 0, guest_departure_date: "2026-06-23" }),
];

// Case 2: rebooking — same ID, DIFFERENT dates (one cancelled reversal, one new booking). Should NOT be flagged.
const rebooking = [
  row({ reservation_id: "20260405-510621-124877758", guest_arrival_date: "2026-04-05", guest_departure_date: "2026-04-03", total_revenue: -1323000 }),
  row({ reservation_id: "20260405-510621-124877758", guest_arrival_date: "2027-04-05", guest_departure_date: "2027-04-08", total_revenue: 1323000 }),
];

// Case 3: genuine copy-paste duplicate — identical ID, dates, AND revenue. SHOULD be flagged.
const trueDupe = [
  row({ reservation_id: "1125", total_revenue: 355092 }),
  row({ reservation_id: "1125", total_revenue: 355092 }),
];

for (const [label, cleanRows] of [["multiVilla", multiVilla], ["rebooking", rebooking], ["trueDupe", trueDupe]]) {
  const findings = runQualityChecks({ propertyCode: "TEST", cleanRows, parseErrors: [], previousFileRowCount: null });
  const dupFindings = findings.filter((f) => f.check_type === "duplicate");
  const anyQuarantinedForDuplicate = cleanRows.some((r) => r.data.quarantine_reason === "duplicate_row_in_file");
  console.log(`${label}: duplicate findings=${dupFindings.length}, quarantined-for-duplicate=${anyQuarantinedForDuplicate}`);
}

const checks = [
  [(() => {
    const f = runQualityChecks({ propertyCode: "TEST", cleanRows: multiVilla, parseErrors: [], previousFileRowCount: null });
    return f.filter((x) => x.check_type === "duplicate").length === 0;
  })(), "multi-villa booking (same ID, same dates, different revenue) must NOT be flagged as duplicate"],
  [(() => {
    const f = runQualityChecks({ propertyCode: "TEST", cleanRows: rebooking, parseErrors: [], previousFileRowCount: null });
    return f.filter((x) => x.check_type === "duplicate").length === 0;
  })(), "rebooking to new dates (same ID, different dates) must NOT be flagged as duplicate"],
  [(() => {
    const f = runQualityChecks({ propertyCode: "TEST", cleanRows: trueDupe, parseErrors: [], previousFileRowCount: null });
    return f.filter((x) => x.check_type === "duplicate").length === 1;
  })(), "identical ID+dates+revenue copy-paste MUST be flagged as duplicate"],
];
const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  console.error("FAILED:");
  failed.forEach(([, msg]) => console.error(" -", msg));
  process.exit(1);
}
console.log("All checks passed.");
