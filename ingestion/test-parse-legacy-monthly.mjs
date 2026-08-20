// Tests the parser's support for the legacy per-month-sheet + suffix-status
// pattern (originally seen in Crystal Sands' old FY 25-26 file). No current
// property is confirmed to use this exact shape anymore — CRS/SIX/SOL/KIR/
// ASM are on the shared "All Bookings" template, and LYN has a real status
// column instead of a suffix. Kept as a standalone test (not loaded from
// properties.yaml) because the capability is real parser code that could be
// needed again — a property migrating backward, or an unseen legacy file.
import * as XLSX from "xlsx";
import { parsePropertyWorkbook } from "./parseExcel.js";

const config = {
  sheet_pattern: "^[A-Z][a-z]{2} \\d{4}$",
  header_row: 1,
  column_map: {
    reservation_id: "Res. No",
    guest_arrival_date: "Arrival",
    guest_departure_date: "Departure",
    booking_date: "DATE OF RESERVATION",
    room_revenue: null,
    total_revenue: "Total Booking Value in LKR",
    status: null,
    channel: "Source",
  },
  date_formats: ["M/D/YYYY", "D/M/YYYY", "MM/DD/YYYY", "DD/MM/YYYY"],
  currency: "LKR",
  status_from_id_suffix: {
    cancelled: ["CXLD", "CANCELLED"],
    confirmed_amended: ["Amended", "Amd"],
  },
  skip_row_if_reservation_id_blank: true,
};

const wb = XLSX.utils.book_new();

const dropDowns = XLSX.utils.aoa_to_sheet([["Payment Status", "Agents"], ["Vouchered", "Suhada"]]);
XLSX.utils.book_append_sheet(wb, dropDowns, "Drop Downs");

const janRows = [
  ["Month", "DATE OF RESERVATION", "Res. No", "Villa", "Arrival", "Departure", "Guest Name", "Source", "New Segment", "Total Booking Value in LKR"],
  ["January", "23-Oct", "1753", "SRF", "1/1/2024", "2/1/2024", "Mrs Anne Humphrey", "Website", "Web", 255274.5],
  ["January", "20-Dec", "2122 - Amended", "PLM", "1/6/2024", "1/6/2024", "Raafique Rheyas", "Direct - Call", "FIT - Local", 9200],
  ["January", "11-Jan", "2024 - CXLD", "SRF", "2/3/2024", "30/01/2024", "Anood Abdul Latif Ahmed", "Booking.com", "OTA", -573388.27],
  ["", "", "", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "Sub Total", 45793144.26],
  ["", "", "", "", "", "", "", "", "Grand Total", 45793144.26],
];
const jan = XLSX.utils.aoa_to_sheet(janRows);
XLSX.utils.book_append_sheet(wb, jan, "Jan 2024");

const febRows = [
  ["Month", "DATE OF RESERVATION", "Res. No", "Villa", "Arrival", "Departure", "Guest Name", "Source", "New Segment", "Total Booking Value in LKR"],
  ["February", "1-Feb", "3001", "SND", "2/5/2024", "2/8/2024", "Test Guest", "Booking.com", "OTA", 300000],
];
const feb = XLSX.utils.aoa_to_sheet(febRows);
XLSX.utils.book_append_sheet(wb, feb, "Feb 2024");

const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

const { rawRows, cleanRows, parseErrors } = parsePropertyWorkbook(buffer, "TEST", config);
console.log("raw rows:", rawRows.length, "clean rows:", cleanRows.length, "parse errors:", parseErrors.length);

const byId = Object.fromEntries(cleanRows.map((r) => [r.data.reservation_id, r.data]));
const checks = [
  [cleanRows.length === 4, `expected 4 clean rows, got ${cleanRows.length}`],
  [byId["2122"]?.status === "confirmed", '"2122 - Amended" should map to status=confirmed with suffix stripped'],
  [byId["2024"]?.status === "cancelled", '"2024 - CXLD" should map to status=cancelled with suffix stripped'],
  [byId["2024"]?.guest_departure_date === "2024-01-30", 'D/M/YYYY date "30/01/2024" should parse correctly, not silently fail'],
  [byId["3001"] !== undefined, "row from the second month sheet (Feb 2024) should be included — multi-sheet concatenation"],
  [parseErrors.length === 0, `expected 0 parse errors, got ${parseErrors.length}`],
];
const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  console.error("FAILED:");
  failed.forEach(([, msg]) => console.error(" -", msg));
  process.exit(1);
}
console.log("All checks passed.");
