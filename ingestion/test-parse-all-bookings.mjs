// Tests the shared "All Bookings" template config — the one CRS, SIX, SOL,
// and KIR actually use. Covers the real-world quirks confirmed against
// those files: forecast/room-blocking rows with blank reservation IDs
// mixed into the data, D-MMM-YY dates, a real Payment Status column, and
// the same reservation number legitimately repeating across rows.
import * as XLSX from "xlsx";
import yaml from "js-yaml";
import fs from "node:fs";
import { parsePropertyWorkbook } from "./parseExcel.js";
import { runQualityChecks } from "./qualityChecks.js";

const config = yaml.load(fs.readFileSync("../config/properties.yaml", "utf8")).properties.CRS;

const wb = XLSX.utils.book_new();

const rows = [
  ["Agent", "Confirmation Date", "Date of Reservation", "Reservation No.", "Room Type", "Month", "Arrival", "Departure", "Guest Name", "Source", "Segment", "Booking Source Channel", "Travel Agent", "Nationality", "Rooms", "Room Nights", "Adults", "Children", "Infants", "Basis", "Marketing Code", "Room Charges", "Meal Charges", "Total Booking Value", "Payment Status", "Remarks", "Financial Year", "Week", "Pax"],
  // forecast/blocking row — blank reservation ID, should be filtered out entirely
  ["", "23-Oct-24", "24-Oct-24", "", "", "Apr-26", "1-Apr-26", "", "", "", "DMC", "", "", "", "", "-", "", "", "", "", "", "-", "-", "-", "", "", "2026-2027", "22-31", 0],
  // real confirmed booking
  ["", "27-Nov-25", "25-Nov-25", "20260403-504092-1249892806", "Entire Villa", "Apr-26", "3-Apr-26", "10-Apr-26", "William Hicks", "TOTA - AM", "DMC", "", "Pan Lanka", "British", 3, 21, 4, 4, 0, "BB", "DMC-RACK", 1118650.75, 265818.0, 1384468.75, "Full Payment", "", "2026-2027", "1-7", 8],
  // multi-room booking — SAME reservation ID, two rows, different room types. Must NOT be flagged as duplicate.
  ["", "28-May-26", "28-May-26", "20260530-504092-1254581275", "Master Suite", "May-26", "30-May-26", "1-Jun-26", "Ms. Jithari Cooray", "Direct - Local - FIT", "FIT - Local", "", "", "Sri Lankan", 1, 2, 2, 0, 0, "BB", "LOCL-SPL", 100800.0, 18000.0, 118800.0, "Deposit Paid", "", "2026-2027", "22-31", 2],
  ["", "28-May-26", "28-May-26", "20260530-504092-1254581275", "Family Suite", "May-26", "30-May-26", "1-Jun-26", "Ms. Jithari Cooray", "Direct - Local - FIT", "FIT - Local", "", "", "Sri Lankan", 1, 2, 2, 0, 0, "BB", "LOCL-SPL", 180000.0, 36000.0, 216000.0, "Deposit Paid", "", "2026-2027", "22-31", 2],
];
const sheet = XLSX.utils.aoa_to_sheet(rows);
XLSX.utils.book_append_sheet(wb, sheet, "All Bookings");

const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

const { rawRows, cleanRows, parseErrors } = parsePropertyWorkbook(buffer, "CRS", config);
console.log("raw rows:", rawRows.length, "clean rows:", cleanRows.length, "parse errors:", parseErrors.length);

const findings = runQualityChecks({ propertyCode: "CRS", cleanRows, parseErrors, previousFileRowCount: null });
const dupFindings = findings.filter((f) => f.check_type === "duplicate");

const byRes = cleanRows.filter((r) => r.data.reservation_id === "20260403-504092-1249892806")[0]?.data;
const multiRoom = cleanRows.filter((r) => r.data.reservation_id === "20260530-504092-1254581275");

const checks = [
  [cleanRows.length === 3, `expected 3 clean rows (forecast row filtered), got ${cleanRows.length}`],
  [byRes?.status === "confirmed", '"Full Payment" should map to status=confirmed'],
  [byRes?.guest_arrival_date === "2026-04-03", 'D-MMM-YY date "3-Apr-26" should parse correctly'],
  [byRes?.period_month === "2026-04-01", 'Month value "Apr-26" should become period_month=2026-04-01'],
  [byRes?.nights === 21, "Room Nights from the workbook should be preserved"],
  [multiRoom.length === 2, `multi-room booking should keep both rows, got ${multiRoom.length}`],
  [dupFindings.length === 0, `multi-room booking with same ID must NOT be flagged as duplicate, got ${dupFindings.length} finding(s)`],
  [parseErrors.length === 0, `expected 0 parse errors, got ${parseErrors.length}`],
];
const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  console.error("FAILED:");
  failed.forEach(([, msg]) => console.error(" -", msg));
  process.exit(1);
}
console.log("All checks passed.");
