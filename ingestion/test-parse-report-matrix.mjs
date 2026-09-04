import * as XLSX from "xlsx";
import { parseReportMatrixRows } from "./parseReportMatrix.js";

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Reservation No."]]), "All Bookings");

const rows = [
  ["September-26"],
  ["Month", "Sep-26", null, null, "Month", "Sep-26"],
  ["Budget 26/27", null, null, null, "Actual 26/27", null, null, null, "Balance To Earn"],
  ["Segment", "Revenue (Incl Taxes)", "Villa Nights", "Budget ARR", "Segment", "Revenue (Incl Taxes)", "Villa Nights", "Actual ARR", "Revenue", "VN"],
  ["DMC", 2394748, 75, 31930, "DMC", 160400, 7, 22914, -2234348, -68],
  ["FIT Local", 3725164, 100, 37252, "FIT - Local", 543750, 10, 54375, "(3,181,414)", "(90)"],
  ["OTA", 11111631, 290, 38316, null, null, null, null, -11111631, -290],
  ["Grand Total", 18695000, 490, 38153, "Grand Total", 704150, 17, 41421, -17990850, -473],
  [],
  [null, "October-26"],
  [null, "Month", "Oct-26", null, null, "Month", "Oct-26"],
  [null, "Budget 26/27", null, null, null, "Actual 26/27", null, null, null, "Balance To Earn"],
  [null, "Segment", "Revenue (Incl Taxes)", "Room Nights", "ARR", "Segment", "Revenue (Incl Taxes)", "Room Nights", "ARR", "Revenue", "VN"],
  [null, "OTA", 4000000, 10, 400000, "OTA", 2500000, 5, 500000, -1500000, -5],
  [null, "Grand Total", 4000000, 10, 400000, "Grand Total", 2500000, 5, 500000, -1500000, -5],
];

XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Revenue & Pickup Report");
const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
const { matrixRows, warnings } = parseReportMatrixRows(buffer, "CRS", "LKR");

console.log("matrix rows:", matrixRows.length, "warnings:", warnings.length);

const bySegment = Object.fromEntries(matrixRows.map((row) => [row.segment, row]));
const checks = [
  [warnings.length === 0, `expected 0 warnings, got ${warnings.length}`],
  [matrixRows.length === 4, `expected 4 segment rows, got ${matrixRows.length}`],
  [bySegment.DMC?.period_month === "2026-09-01", `expected Sep-26 to parse, got ${bySegment.DMC?.period_month}`],
  [bySegment["FIT - Local"]?.balance_revenue === -3181414, `expected bracketed negative revenue, got ${bySegment["FIT - Local"]?.balance_revenue}`],
  [matrixRows.some((row) => row.period_month === "2026-10-01" && row.segment === "OTA" && row.actual_revenue === 2500000), "expected shifted OTA layout to parse"],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  console.error("FAILED:");
  failed.forEach(([, msg]) => console.error(" -", msg));
  process.exit(1);
}
console.log("All checks passed.");
