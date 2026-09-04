import * as XLSX from "xlsx";
import { parseBudgetRows } from "./parseBudget.js";

function workbookWithReport(sheetName, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["ignore me"]]), "All Bookings");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

const normalLayout = workbookWithReport("Revenue & Pickup Report", [
  ["Budget 26/27", null, null, null, "Actual 26/27"],
  ["Month", "Revenue (Incl Taxes)", "Villa Nights", "Budget ARR", "Month"],
  ["Apr-26", 1000000, 10, 100000, "Apr-26"],
  ["May-26", "2,500,000", 20, 125000, "May-26"],
  ["Grand Total", 3500000],
]);

const shiftedLayout = workbookWithReport("Revenue Pickup Report", [
  [null, "Budget 26/27", null, null, null, "Actual 26/27"],
  [null, "Month", "Revenue (Incl Taxes)", "Villa Nights", "Budget ARR", "Month"],
  [null, "Jun-26", 3000000, 30, 100000, "Jun-26"],
  [null, "Jul-26", "-", 0, 0, "Jul-26"],
  [null, "Grand Total", 3000000],
]);

const normal = parseBudgetRows(normalLayout, "CRS", "LKR");
const shifted = parseBudgetRows(shiftedLayout, "SIX", "LKR");

console.log("normal budget rows:", normal.budgetRows.length, "warnings:", normal.warnings.length);
console.log("shifted budget rows:", shifted.budgetRows.length, "warnings:", shifted.warnings.length);

const checks = [
  [normal.warnings.length === 0, `expected 0 warnings for normal layout, got ${normal.warnings.length}`],
  [normal.budgetRows.length === 2, `expected 2 normal budget rows, got ${normal.budgetRows.length}`],
  [normal.budgetRows[0]?.period_month === "2026-04-01", `expected Apr-26 to parse to 2026-04-01, got ${normal.budgetRows[0]?.period_month}`],
  [normal.budgetRows[1]?.budgeted_revenue === 2500000, `expected comma number to parse, got ${normal.budgetRows[1]?.budgeted_revenue}`],
  [shifted.warnings.length === 0, `expected 0 warnings for shifted layout, got ${shifted.warnings.length}`],
  [shifted.budgetRows.length === 2, `expected 2 shifted budget rows, got ${shifted.budgetRows.length}`],
  [shifted.budgetRows[0]?.period_month === "2026-06-01", `expected Jun-26 to parse to 2026-06-01, got ${shifted.budgetRows[0]?.period_month}`],
  [shifted.budgetRows[1]?.budgeted_revenue === 0, `expected dash budget value to parse as 0, got ${shifted.budgetRows[1]?.budgeted_revenue}`],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  console.error("FAILED:");
  failed.forEach(([, msg]) => console.error(" -", msg));
  process.exit(1);
}
console.log("All checks passed.");
