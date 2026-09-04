/**
 * Revenue Dashboard workbook governance
 *
 * Run this inside each SharePoint workbook from Excel Online:
 * Automate -> New Script -> paste this file -> Run.
 *
 * This edits the live workbook in place, so it avoids rebuilding the .xlsx
 * package and preserves Excel Online features such as pivots and slicers.
 */
function main(workbook: ExcelScript.Workbook) {
  const password = "CPGRevenue2026";
  const sheet = workbook.getWorksheet("All Bookings");
  if (!sheet) {
    throw new Error("No sheet named 'All Bookings' was found.");
  }

  const usedRange = sheet.getUsedRange();
  if (!usedRange) {
    throw new Error("'All Bookings' is empty.");
  }

  const maxRows = Math.max(Math.min(usedRange.getRowCount(), 5000), 2000);
  const maxCols = Math.max(usedRange.getColumnCount(), STANDARD_HEADERS.length);

  pauseProtectionIfNeeded(sheet, password);
  standardizeHeaders(sheet, maxCols);

  const headers = getHeaderMap(sheet, maxCols);
  for (const header of STANDARD_HEADERS) {
    if (headers[header] === undefined) {
      const addAt = sheet.getUsedRange().getColumnCount();
      sheet.getCell(0, addAt).setValue(header);
    }
  }

  const finalColumnCount = Math.max(sheet.getUsedRange().getColumnCount(), STANDARD_HEADERS.length);
  const finalHeaders = getHeaderMap(sheet, finalColumnCount);
  formatHeader(sheet, finalColumnCount);
  sheet.getFreezePanes().freezeRows(1);
  applyFilterIfPossible(sheet, maxRows, finalColumnCount);
  prepareAllBookingsLocking(sheet, maxRows, finalColumnCount);

  applyListValidation(sheet, finalHeaders, "Segment", "DMC,FIT - Foreign,FIT - Local,OTA,Owner,Unassigned", maxRows);
  applyListValidation(sheet, finalHeaders, "Payment Status", "Vouchered,Deposit Paid,Pending Payment,Full Payment,Cancelled,No Show", maxRows);
  applyListValidation(sheet, finalHeaders, "Basis", "RO,VO,BB,HB,FB", maxRows);

  for (const header of ["Confirmation Date", "Date of Reservation", "Arrival", "Departure"]) {
    applyDateValidation(sheet, finalHeaders, header, maxRows);
  }

  const arrivalLetter = columnLetter(finalHeaders["Arrival"]);
  const departureLetter = columnLetter(finalHeaders["Departure"]);
  const monthLetter = columnLetter(finalHeaders["Month"]);
  const statusLetter = columnLetter(finalHeaders["Payment Status"]);
  const remarksLetter = columnLetter(finalHeaders["Remarks"]);

  applyCustomValidation(
    sheet,
    finalHeaders,
    "Departure",
    (row) =>
      `=OR($${departureLetter}${row}="",$${arrivalLetter}${row}="",$${departureLetter}${row}>=$${arrivalLetter}${row},LOWER($${statusLetter}${row})="cancelled",ISNUMBER(SEARCH("cancel",$${remarksLetter}${row})),ISNUMBER(SEARCH("amend",$${remarksLetter}${row})))`,
    "Invalid stay dates",
    "Departure must be on or after arrival, except cancellation/amendment reversal rows.",
    maxRows
  );

  applyCustomValidation(
    sheet,
    finalHeaders,
    "Month",
    (row) =>
      `=OR($${monthLetter}${row}="",$${arrivalLetter}${row}="",TEXT($${arrivalLetter}${row},"mmm-yy")=$${monthLetter}${row})`,
    "Month does not match arrival",
    "Month must match the arrival month, for example Jul-26.",
    maxRows
  );

  for (const header of ["Rooms", "Room Nights", "Adults", "Children", "Infants", "Pax"]) {
    applyNonNegativeUnlessCancelled(sheet, finalHeaders, header, maxRows);
  }

  for (const header of ["Room Charges", "Meal Charges", "Total Booking Value"]) {
    applyNonNegativeUnlessCancelled(sheet, finalHeaders, header, maxRows);
  }

  protectSheets(workbook, password);

  console.log("Revenue Dashboard workbook governance applied.");
}

const STANDARD_HEADERS = [
  "Agent",
  "Confirmation Date",
  "Date of Reservation",
  "Reservation No.",
  "Room Type",
  "Month",
  "Arrival",
  "Departure",
  "Guest Name",
  "Source",
  "Segment",
  "Booking Source Channel",
  "Travel Agent",
  "Nationality",
  "Rooms",
  "Room Nights",
  "Adults",
  "Children",
  "Infants",
  "Basis",
  "Marketing Code",
  "Room Charges",
  "Meal Charges",
  "Total Booking Value",
  "Payment Status",
  "Remarks",
  "Financial Year",
  "Week",
  "Pax",
];

function standardizeHeaders(sheet: ExcelScript.Worksheet, maxCols: number) {
  const headerRange = sheet.getRangeByIndexes(0, 0, 1, maxCols);
  const values = headerRange.getTexts()[0];
  const seen: { [key: string]: boolean } = {};

  values.forEach((value, index) => {
    const normalized = normalizeHeader(value);
    if (!normalized) return;
    if (seen[normalized] && normalized !== value) return;
    seen[normalized] = true;
    if (normalized !== value) {
      sheet.getCell(0, index).setValue(normalized);
    }
  });
}

function normalizeHeader(value: string): string {
  const raw = (value || "").replace(/\n/g, " ").trim();
  const key = raw.toLowerCase();
  const aliases: { [key: string]: string } = {
    "revenue from santani": "Agent",
    "reservation no": "Reservation No.",
    "reservation number": "Reservation No.",
    "villa": "Room Type",
    "villa nights": "Room Nights",
    "vn": "Room Nights",
    "rn": "Room Nights",
    "meal charges(hb/fb/other)": "Meal Charges",
    "meal charges (hb/fb/other)": "Meal Charges",
    "pax": "Pax",
  };
  return aliases[key] || raw;
}

function getHeaderMap(sheet: ExcelScript.Worksheet, maxCols: number): { [key: string]: number } {
  const headerRange = sheet.getRangeByIndexes(0, 0, 1, maxCols);
  const values = headerRange.getTexts()[0];
  const map: { [key: string]: number } = {};
  values.forEach((value, index) => {
    const header = (value || "").trim();
    if (header && map[header] === undefined) {
      map[header] = index;
    }
  });
  return map;
}

function formatHeader(sheet: ExcelScript.Worksheet, maxCols: number) {
  const range = sheet.getRangeByIndexes(0, 0, 1, maxCols);
  range.getFormat().getFont().setBold(true);
  range.getFormat().getFont().setColor("#143D36");
  range.getFormat().getFill().setColor("#D9EAF7");
}

function prepareAllBookingsLocking(sheet: ExcelScript.Worksheet, maxRows: number, maxCols: number) {
  const entryRange = sheet.getRangeByIndexes(1, 0, maxRows - 1, maxCols);
  entryRange.getFormat().getProtection().setLocked(false);

  const headerRange = sheet.getRangeByIndexes(0, 0, 1, maxCols);
  headerRange.getFormat().getProtection().setLocked(true);
}

function applyFilterIfPossible(sheet: ExcelScript.Worksheet, maxRows: number, maxCols: number) {
  try {
    const lastColumn = columnLetter(maxCols - 1);
    sheet.getAutoFilter().apply(`${sheet.getName()}!A1:${lastColumn}${maxRows}`);
  } catch (error) {
    console.log("Skipped filter re-application; existing table/filter controls can stay as-is.");
  }
}

function applyListValidation(
  sheet: ExcelScript.Worksheet,
  headers: { [key: string]: number },
  header: string,
  source: string,
  maxRows: number
) {
  const col = headers[header];
  if (col === undefined) return;
  const range = sheet.getRangeByIndexes(1, col, maxRows - 1, 1);
  const validation = range.getDataValidation();
  validation.clear();
  validation.setIgnoreBlanks(true);
  validation.setRule({ list: { inCellDropDown: true, source } });
  validation.setErrorAlert({
    showAlert: true,
    style: ExcelScript.DataValidationAlertStyle.stop,
    title: `Invalid ${header}`,
    message: `Choose a valid ${header} from the dropdown.`,
  });
}

function applyDateValidation(
  sheet: ExcelScript.Worksheet,
  headers: { [key: string]: number },
  header: string,
  maxRows: number
) {
  const col = headers[header];
  if (col === undefined) return;
  const range = sheet.getRangeByIndexes(1, col, maxRows - 1, 1);
  const validation = range.getDataValidation();
  validation.clear();
  validation.setIgnoreBlanks(true);
  validation.setRule({
    date: {
      formula1: "DATE(2024,1,1)",
      formula2: "DATE(2028,3,31)",
      operator: ExcelScript.DataValidationOperator.between,
    },
  });
  validation.setErrorAlert({
    showAlert: true,
    style: ExcelScript.DataValidationAlertStyle.stop,
    title: `Invalid ${header}`,
    message: "Enter a real date between 1 Jan 2024 and 31 Mar 2028.",
  });
}

function applyCustomValidation(
  sheet: ExcelScript.Worksheet,
  headers: { [key: string]: number },
  header: string,
  formulaForRow: (rowNumber: number) => string,
  title: string,
  message: string,
  maxRows: number
) {
  const col = headers[header];
  if (col === undefined) return;
  const range = sheet.getRangeByIndexes(1, col, maxRows - 1, 1);
  const validation = range.getDataValidation();
  validation.clear();
  validation.setIgnoreBlanks(true);
  validation.setRule({ custom: { formula: formulaForRow(2) } });
  validation.setErrorAlert({
    showAlert: true,
    style: ExcelScript.DataValidationAlertStyle.stop,
    title,
    message,
  });
}

function applyNonNegativeUnlessCancelled(
  sheet: ExcelScript.Worksheet,
  headers: { [key: string]: number },
  header: string,
  maxRows: number
) {
  const col = headers[header];
  if (col === undefined) return;
  const letter = columnLetter(col);
  const statusLetter = columnLetter(headers["Payment Status"]);
  const remarksLetter = columnLetter(headers["Remarks"]);
  applyCustomValidation(
    sheet,
    headers,
    header,
    (row) =>
      `=OR(${letter}${row}="",${letter}${row}>=0,LOWER($${statusLetter}${row})="cancelled",ISNUMBER(SEARCH("cancel",$${remarksLetter}${row})),ISNUMBER(SEARCH("amend",$${remarksLetter}${row})))`,
    `Invalid ${header}`,
    `${header} should not be negative unless this is a cancellation/amendment reversal row.`,
    maxRows
  );
}

function protectSheets(workbook: ExcelScript.Workbook, password: string) {
  for (const sheet of workbook.getWorksheets()) {
    const protection = sheet.getProtection();
    if (protection.getProtected()) {
      if (protection.getIsPaused()) {
        protection.resumeProtection();
      }
      continue;
    }

    const options: ExcelScript.WorksheetProtectionOptions = {
      allowAutoFilter: true,
      allowSort: true,
      allowFormatColumns: true,
      allowFormatRows: true,
      selectionMode: ExcelScript.ProtectionSelectionMode.normal,
    };

    protection.protect(options, password);
  }
}

function pauseProtectionIfNeeded(sheet: ExcelScript.Worksheet, password: string) {
  const protection = sheet.getProtection();
  if (!protection.getProtected()) return;
  if (protection.checkPassword(password)) {
    protection.pauseProtection(password);
  } else {
    throw new Error("'All Bookings' is already protected with a different password.");
  }
}

function columnLetter(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1;
  let result = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}
