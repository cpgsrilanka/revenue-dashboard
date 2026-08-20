// Shaped exactly like the real v_monthly_revenue / data_quality_log rows so
// swapping in live Supabase queries later requires no component changes —
// only lib/queries.js needs to stop returning this and start awaiting Supabase.

export const mockMonthlyRevenue = [
  { property_code: "CRS", property_name: "Crystal Sands", entity: "CPG", actual_revenue: 18420000, budgeted_revenue: 17500000, reservation_count: 214, currency: "LKR", trend: [12, 14, 13, 16, 15, 18] },
  { property_code: "SIX", property_name: "The Six", entity: "CPG", actual_revenue: 9860000, budgeted_revenue: 10500000, reservation_count: 132, currency: "LKR", trend: [9, 8, 9, 10, 9, 9.9] },
  { property_code: "ASM", property_name: "Asaya Sands", entity: "OGH", actual_revenue: 14200000, budgeted_revenue: 13000000, reservation_count: 176, currency: "LKR", trend: [11, 12, 12, 13, 13, 14.2] },
  { property_code: "LYN", property_name: "77 Leyn Baan", entity: "OGH", actual_revenue: 5230000, budgeted_revenue: 5500000, reservation_count: 61, currency: "LKR", trend: [5, 5.2, 4.8, 5, 5.3, 5.2] },
  { property_code: "KIR", property_name: "Kirana Villa", entity: "OGH", actual_revenue: 3110000, budgeted_revenue: 3000000, reservation_count: 34, currency: "LKR", trend: [2.6, 2.8, 2.9, 3, 3, 3.1] },
  { property_code: "SOL", property_name: "Sol House", entity: "OGH", actual_revenue: 6780000, budgeted_revenue: 7200000, reservation_count: 88, currency: "LKR", trend: [6.9, 6.7, 6.5, 6.8, 6.6, 6.8] }
];

export const mockDataQualityLog = [
  { id: 1, property_code: "SIX", check_type: "completeness", severity: "warning", message: "Row count dropped from 148 to 132 vs the previous file.", detected_at: "2026-08-18T21:32:00Z", resolved: false },
  { id: 2, property_code: "LYN", check_type: "range", severity: "critical", message: "1 confirmed reservation has no total_revenue value.", detected_at: "2026-08-18T21:33:00Z", resolved: false },
  { id: 3, property_code: "ASM", check_type: "referential", severity: "info", message: "2 reservations had a status value not in status_map — logged as unknown.", detected_at: "2026-08-18T21:33:30Z", resolved: false }
];

export const mockLastIngested = {
  CRS: "2026-08-19T02:14:00Z",
  SIX: "2026-08-19T02:14:00Z",
  ASM: "2026-08-19T02:15:00Z",
  LYN: "2026-08-19T02:15:00Z",
  KIR: "2026-08-19T02:16:00Z",
  SOL: "2026-08-19T02:16:00Z"
};
