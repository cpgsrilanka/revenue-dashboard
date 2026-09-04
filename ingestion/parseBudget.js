import * as XLSX from "xlsx";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";

dayjs.extend(customParseFormat);

const REPORT_SHEET_RE = /revenue\s*&?\s*pick\s*up|revenue\s*pickup/i;

export function parseBudgetRows(buffer, propertyCode, currency = "LKR") {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames.find((name) => REPORT_SHEET_RE.test(name));

  if (!sheetName) {
    return {
      budgetRows: [],
      warnings: [
        `No revenue pickup report sheet found. Available sheets: ${workbook.SheetNames.join(", ")}`,
      ],
    };
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: true,
  });

  const markers = findBudgetMarkers(rows);
  if (markers.length === 0) {
    return {
      budgetRows: [],
      warnings: [`No "Budget 26/27" section found in sheet "${sheetName}".`],
    };
  }

  const header = markers
    .map((marker) => findBudgetHeader(rows, marker.rowIndex, marker.colIndex))
    .find(Boolean);
  if (!header) {
    return {
      budgetRows: [],
      warnings: [`No Month / Revenue header found below budget section in sheet "${sheetName}".`],
    };
  }

  const budgetRows = [];
  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const monthValue = row[header.monthCol];
    const label = normalizeText(monthValue);

    if (!label) continue;
    if (/grand\s*total|total/i.test(label)) break;

    const periodMonth = parsePeriodMonth(monthValue);
    if (!periodMonth) continue;

    const budgetedRevenue = toNumber(row[header.revenueCol]);
    if (budgetedRevenue === null) continue;

    budgetRows.push({
      property_code: propertyCode,
      period_month: periodMonth,
      budgeted_revenue: budgetedRevenue,
      currency,
    });
  }

  return { budgetRows, warnings: [] };
}

function findBudgetMarkers(rows) {
  const markers = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const text = normalizeText(row[colIndex]);
      if (/budget/i.test(text) && /26\s*[/.-]\s*27|26\/27/i.test(text)) {
        markers.push({ rowIndex, colIndex });
      }
    }
  }
  return markers;
}

function findBudgetHeader(rows, markerRowIndex, markerColIndex) {
  const lastRowIndex = Math.min(markerRowIndex + 10, rows.length - 1);
  for (let rowIndex = markerRowIndex + 1; rowIndex <= lastRowIndex; rowIndex++) {
    const row = rows[rowIndex] || [];
    const firstCol = Math.max(0, markerColIndex - 1);
    const lastCol = Math.min(row.length - 1, markerColIndex + 6);

    for (let colIndex = firstCol; colIndex <= lastCol; colIndex++) {
      if (normalizeText(row[colIndex]).toLowerCase() !== "month") continue;

      for (let revenueCol = colIndex + 1; revenueCol <= Math.min(lastCol, colIndex + 4); revenueCol++) {
        if (/revenue/i.test(normalizeText(row[revenueCol]))) {
          return { rowIndex, monthCol: colIndex, revenueCol };
        }
      }
    }
  }
  return null;
}

function parsePeriodMonth(value) {
  if (typeof value === "number") {
    const parsed = XLSX.SSF?.parse_date_code(value);
    if (!parsed) return null;
    return dayjs(new Date(parsed.y, parsed.m - 1, 1)).format("YYYY-MM-DD");
  }

  const raw = normalizeText(value);
  if (!raw) return null;

  const formats = ["MMM-YY", "MMM YY", "MMM-YYYY", "MMM YYYY", "MMMM-YY", "MMMM YY", "MMMM-YYYY", "MMMM YYYY"];
  for (const format of formats) {
    const parsed = dayjs(raw, format, true);
    if (parsed.isValid()) return parsed.date(1).format("YYYY-MM-DD");
  }

  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return null;
  if (/^-+$/.test(cleaned)) return 0;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(value) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}
