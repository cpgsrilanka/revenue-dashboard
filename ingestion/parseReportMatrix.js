import * as XLSX from "xlsx";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";

dayjs.extend(customParseFormat);

const REPORT_SHEET_RE = /revenue\s*&?\s*pick\s*up|revenue\s*pickup/i;

export function parseReportMatrixRows(buffer, propertyCode, currency = "LKR") {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames.find((name) => REPORT_SHEET_RE.test(name));

  if (!sheetName) {
    return {
      matrixRows: [],
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

  const matrixRows = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const header = getSegmentHeader(rows[rowIndex]);
    if (!header) continue;

    const periodMonth = findNearestMonth(rows, rowIndex);
    if (!periodMonth) continue;

    for (let dataRowIndex = rowIndex + 1; dataRowIndex < rows.length; dataRowIndex++) {
      const row = rows[dataRowIndex] || [];
      const budgetSegment = normalizeSegment(row[header.budgetSegmentCol]);
      const actualSegment = normalizeSegment(row[header.actualSegmentCol]);
      const segment = budgetSegment || actualSegment;

      if (!segment) continue;
      if (segment === "Grand Total") break;

      matrixRows.push({
        property_code: propertyCode,
        period_month: periodMonth,
        segment,
        budget_revenue: toNumber(row[header.budgetRevenueCol]) || 0,
        budget_room_nights: toNumber(row[header.budgetNightsCol]) || 0,
        budget_arr: toNumber(row[header.budgetArrCol]) || 0,
        actual_revenue: toNumber(row[header.actualRevenueCol]) || 0,
        actual_room_nights: toNumber(row[header.actualNightsCol]) || 0,
        actual_arr: toNumber(row[header.actualArrCol]) || 0,
        balance_revenue: toNumber(row[header.balanceRevenueCol]) || 0,
        balance_room_nights: toNumber(row[header.balanceNightsCol]) || 0,
        currency,
      });
    }
  }

  const detailedRows = dedupeMatrixRows(matrixRows);
  const monthsWithDetailedRows = new Set(detailedRows.map((row) => row.period_month));
  const summaryRows = parseMonthlySummaryRows(rows, propertyCode, currency).filter(
    (row) => !monthsWithDetailedRows.has(row.period_month)
  );

  return { matrixRows: [...detailedRows, ...summaryRows], warnings: [] };
}

function getSegmentHeader(row = []) {
  for (let col = 0; col < row.length; col++) {
    if (normalizeText(row[col]).toLowerCase() !== "segment") continue;
    if (!/revenue/i.test(normalizeText(row[col + 1]))) continue;
    if (!/villa|room/i.test(normalizeText(row[col + 2]))) continue;
    if (normalizeText(row[col + 4]).toLowerCase() !== "segment") continue;
    if (!/revenue/i.test(normalizeText(row[col + 5]))) continue;

    return {
      budgetSegmentCol: col,
      budgetRevenueCol: col + 1,
      budgetNightsCol: col + 2,
      budgetArrCol: col + 3,
      actualSegmentCol: col + 4,
      actualRevenueCol: col + 5,
      actualNightsCol: col + 6,
      actualArrCol: col + 7,
      balanceRevenueCol: col + 8,
      balanceNightsCol: col + 9,
    };
  }
  return null;
}

function parseMonthlySummaryRows(rows, propertyCode, currency) {
  const summaryRows = [];
  const header = findMonthlySummaryHeader(rows);
  if (!header) return summaryRows;

  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const label = normalizeText(row[header.budgetMonthCol]);

    if (!label) continue;
    if (/grand\s*total|total/i.test(label)) break;

    const periodMonth = parsePeriodMonth(label);
    if (!periodMonth) continue;

    summaryRows.push({
      property_code: propertyCode,
      period_month: periodMonth,
      segment: "Total",
      budget_revenue: toNumber(row[header.budgetRevenueCol]) || 0,
      budget_room_nights: toNumber(row[header.budgetNightsCol]) || 0,
      budget_arr: toNumber(row[header.budgetArrCol]) || 0,
      actual_revenue: toNumber(row[header.actualRevenueCol]) || 0,
      actual_room_nights: toNumber(row[header.actualNightsCol]) || 0,
      actual_arr: toNumber(row[header.actualArrCol]) || 0,
      balance_revenue: toNumber(row[header.balanceRevenueCol]) || 0,
      balance_room_nights: toNumber(row[header.balanceNightsCol]) || 0,
      currency,
    });
  }

  return summaryRows;
}

function findMonthlySummaryHeader(rows) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex++) {
    const row = rows[rowIndex] || [];
    for (let col = 0; col < row.length; col++) {
      if (normalizeText(row[col]).toLowerCase() !== "month") continue;
      if (!/revenue/i.test(normalizeText(row[col + 1]))) continue;
      if (!/villa|room/i.test(normalizeText(row[col + 2]))) continue;
      if (normalizeText(row[col + 4]).toLowerCase() !== "month") continue;
      if (!/revenue/i.test(normalizeText(row[col + 5]))) continue;

      return {
        rowIndex,
        budgetMonthCol: col,
        budgetRevenueCol: col + 1,
        budgetNightsCol: col + 2,
        budgetArrCol: col + 3,
        actualMonthCol: col + 4,
        actualRevenueCol: col + 5,
        actualNightsCol: col + 6,
        actualArrCol: col + 7,
        balanceRevenueCol: col + 8,
        balanceNightsCol: col + 9,
      };
    }
  }
  return null;
}

function findNearestMonth(rows, fromRowIndex) {
  for (let rowIndex = fromRowIndex - 1; rowIndex >= Math.max(0, fromRowIndex - 4); rowIndex--) {
    const row = rows[rowIndex] || [];
    for (const value of row.slice(0, 6)) {
      const parsed = parsePeriodMonth(value);
      if (parsed) return parsed;
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

  const formats = ["MMM-YY", "MMM YY", "MMMM-YY", "MMMM YY", "MMM-YYYY", "MMMM-YYYY"];
  for (const format of formats) {
    const parsed = dayjs(raw, format, true);
    if (parsed.isValid()) return parsed.date(1).format("YYYY-MM-DD");
  }
  return null;
}

function dedupeMatrixRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    byKey.set(`${row.property_code}|${row.period_month}|${row.segment}`, row);
  }
  return [...byKey.values()];
}

function normalizeSegment(value) {
  const text = normalizeText(value);
  if (!text || /^\(?blank\)?$/i.test(text)) return "";
  return text
    .replace(/\s*-\s*/g, " - ")
    .replace(/^FIT\s*Foreign$/i, "FIT - Foreign")
    .replace(/^FIT\s*Local$/i, "FIT - Local")
    .replace(/^Owners$/i, "Owner");
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const raw = String(value).replace(/,/g, "").trim();
  const negativeParentheses = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[()]/g, "").trim();
  if (!cleaned) return null;
  if (/^-+$/.test(cleaned)) return 0;

  const n = Number(cleaned);
  return Number.isFinite(n) ? (negativeParentheses ? -n : n) : null;
}

function normalizeText(value) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}
