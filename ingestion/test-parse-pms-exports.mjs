import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parsePmsExport } from "./parsePmsExport.js";
import { runQualityChecks } from "./qualityChecks.js";

function makeWorkbook(headers, rows, sheetName = "export") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

const operaXml = `<?xml version="1.0"?><RES_DETAIL><LIST_G_GROUP_BY1><G_GROUP_BY1><LIST_G_RESERVATION>
  <G_RESERVATION><RESV_NAME_ID>101</RESV_NAME_ID><CONFIRMATION_NO>OP-001</CONFIRMATION_NO><UPDATE_DATE>15-SEP-26</UPDATE_DATE><SHORT_RESV_STATUS>CON</SHORT_RESV_STATUS><ARRIVAL>01-OCT-26</ARRIVAL><DEPARTURE>04-OCT-26</DEPARTURE><NO_OF_ROOMS>2</NO_OF_ROOMS><MARKET_CODE>OTA</MARKET_CODE><ORIGIN_OF_BOOKING>BKNG</ORIGIN_OF_BOOKING><CURRENCY_CODE>USD</CURRENCY_CODE><EFFECTIVE_RATE_AMOUNT>100</EFFECTIVE_RATE_AMOUNT><DEPOSIT_PAID>50</DEPOSIT_PAID></G_RESERVATION>
  <G_RESERVATION><RESV_NAME_ID>102</RESV_NAME_ID><CONFIRMATION_NO>OP-002</CONFIRMATION_NO><UPDATE_DATE>15-SEP-26</UPDATE_DATE><SHORT_RESV_STATUS>CXL</SHORT_RESV_STATUS><ARRIVAL>05-OCT-26</ARRIVAL><DEPARTURE>07-OCT-26</DEPARTURE><NO_OF_ROOMS>1</NO_OF_ROOMS><CURRENCY_CODE>LKR</CURRENCY_CODE><EFFECTIVE_RATE_AMOUNT>10000</EFFECTIVE_RATE_AMOUNT></G_RESERVATION>
</LIST_G_RESERVATION></G_GROUP_BY1></LIST_G_GROUP_BY1></RES_DETAIL>`;

const opera = parsePmsExport(Buffer.from(operaXml), "CRS", {
  currency: "LKR",
  pms: { adapter: "opera_xml", revenue_mode: "rate_only" },
});
assert.equal(opera.cleanRows.length, 2);
assert.equal(opera.cleanRows[0].data.reservation_id, "OP-001");
assert.equal(opera.cleanRows[0].data.source_record_id, "101");
assert.equal(opera.cleanRows[0].data.nights, 6);
assert.equal(opera.cleanRows[0].data.total_revenue, null);
assert.equal(opera.cleanRows[1].data.status, "cancelled");
assert.equal(opera.cleanRows[1].data.nights, 0);
assert.equal(opera.cleanRows[1].data.total_revenue, 0);
assert.equal("FULL_NAME" in opera.rawRows[0].data, false);

const exely = parsePmsExport(
  makeWorkbook(
    ["Booking No.", "Rooms", "Total amount", "Prepaid amount", "Booking date", "Check-in date", "Departure date", "Booking status", "Point of sale", "Agent's rate plan", "Guest"],
    [["EX-001", 2, 600, 100, "2026-09-15 09:00:00", "2026-10-01 14:00:00", "2026-10-04 11:00:00", "Active", "Booking.com", "OTA", "Do Not Store"]],
    "Report"
  ),
  "SOL",
  { currency: "LKR", pms: { adapter: "exely_xlsx" } }
);
assert.equal(exely.cleanRows.length, 1);
assert.equal(exely.cleanRows[0].data.nights, 6);
assert.equal(exely.cleanRows[0].data.total_revenue, 600);
assert.equal(exely.cleanRows[0].data.booking_date, "2026-09-15");
assert.equal("Guest" in exely.rawRows[0].data, false);

const hotelTime = parsePmsExport(
  makeWorkbook(
    ["Reservation number", "Room type", "Room", "Reservation source", "Segment", "Arrival", "Departure", "Created", "State", "Nights", "ARR *2)", "Total for accommodation", "Total inc. VAT *1)", "Unpaid *1)", "Currency"],
    [
      ["HT-001", "Villa A", "A1", "Travel Agent", "FIT", new Date(2026, 9, 1), new Date(2026, 9, 4), new Date(2026, 8, 1), "Confirmed", 3, 100, 300, 330, 230, "USD"],
      ["HT-001", "Villa B", "B1", "Travel Agent", "FIT", new Date(2026, 9, 1), new Date(2026, 9, 4), new Date(2026, 8, 1), "Confirmed", 3, 100, 300, 330, 230, "USD"],
      ["HT-002", "Villa C", "C1", "Direct", "FIT", new Date(2026, 9, 5), new Date(2026, 9, 7), new Date(2026, 8, 1), "Cancelled", 2, 100, 200, 220, 0, "LKR"],
    ]
  ),
  "SIX",
  { currency: "LKR", pms: { adapter: "hoteltime_xlsx", sheet_name: "export" } }
);
assert.equal(hotelTime.cleanRows.length, 3);
assert.notEqual(hotelTime.cleanRows[0].data.source_record_id, hotelTime.cleanRows[1].data.source_record_id);
assert.equal(hotelTime.cleanRows[0].data.total_revenue, 330);
assert.equal(hotelTime.cleanRows[2].data.nights, 0);
assert.equal(hotelTime.cleanRows[2].data.total_revenue, 0);
const hotelTimeFindings = runQualityChecks({
  propertyCode: "SIX",
  cleanRows: hotelTime.cleanRows,
  parseErrors: hotelTime.parseErrors,
  previousFileRowCount: null,
});
assert.equal(hotelTimeFindings.some((finding) => finding.check_type === "duplicate"), false);

const operaFindings = runQualityChecks({
  propertyCode: "CRS",
  cleanRows: opera.cleanRows,
  parseErrors: opera.parseErrors,
  previousFileRowCount: null,
  requireTotalRevenue: false,
});
assert.equal(operaFindings.some((finding) => finding.message.includes("no total_revenue")), false);

console.log("PMS adapter parser checks passed.");
