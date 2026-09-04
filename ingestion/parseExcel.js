import * as XLSX from "xlsx";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";

dayjs.extend(customParseFormat);

const excelDateParser = XLSX.SSF || XLSX.default?.SSF;

/**
 * Parses a property's Excel file buffer into:
 *   - rawRows: every row as-is (column name -> value), for the raw layer
 *   - cleanRows: mapped into the unified schema, for the clean layer
 *   - parseErrors: rows that couldn't be mapped, with a reason
 *
 * `config` is the property's entry from config/properties.yaml.
 *
 * Supports two sheet-selection modes, since real workbooks vary:
 *   - config.sheet_name: a single fixed sheet (the "clean" case)
 *   - config.sheet_pattern: a regex matched against every sheet name in the
 *     workbook; every matching sheet is read and concatenated (the real
 *     Crystal Sands / Leyn Baan case — one hidden sheet per month)
 */
export function parsePropertyWorkbook(buffer, propertyCode, config) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });

  const sheetNames = selectSheets(workbook, config);
  if (sheetNames.length === 0) {
    throw new Error(
      `No sheet matched for ${propertyCode} (sheet_name="${config.sheet_name}", ` +
      `sheet_pattern="${config.sheet_pattern}"). Available sheets: ${workbook.SheetNames.join(", ")}`
    );
  }

  const rawRows = [];
  const cleanRows = [];
  const parseErrors = [];

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const headerRowIndex = (config.header_row || 1) - 1;
    const rows = XLSX.utils.sheet_to_json(sheet, {
      range: headerRowIndex,
      defval: null,
      raw: true,
    });

    rows.forEach((row, idx) => {
      const sourceRowNumber = idx + headerRowIndex + 2;

      if (shouldSkipRow(row, config)) return;

      rawRows.push({ sourceRowNumber, sheetName, data: row });

      try {
        const clean = mapRowToUnifiedSchema(row, propertyCode, config);
        if (clean) {
          cleanRows.push({ sourceRowNumber, sheetName, data: clean });
        }
      } catch (err) {
        parseErrors.push({
          sourceRowNumber,
          sheetName,
          reason: err.message,
          rawRow: row,
        });
      }
    });
  }

  return { rawRows, cleanRows, parseErrors };
}

function selectSheets(workbook, config) {
  if (config.sheet_name) {
    return workbook.SheetNames.includes(config.sheet_name) ? [config.sheet_name] : [];
  }
  if (config.sheet_pattern) {
    const re = new RegExp(config.sheet_pattern);
    return workbook.SheetNames.filter((name) => re.test(name));
  }
  return workbook.SheetNames.slice(0, 1);
}

/**
 * Filters out the summary/subtotal rows real exports mix into the data
 * range (e.g. "Sub Total", "Grand Total", or per-segment breakdown rows
 * at the bottom of each month's sheet), and blank trailing rows.
 */
function shouldSkipRow(row, config) {
  const values = Object.values(row).map((v) => (v === null ? "" : String(v)));

  if (config.skip_row_if_any_cell_matches) {
    const matches = config.skip_row_if_any_cell_matches.some((needle) =>
      values.some((v) => v.trim() === needle)
    );
    if (matches) return true;
  }

  if (config.skip_row_if_reservation_id_blank && config.column_map?.reservation_id) {
    const idValue = row[config.column_map.reservation_id];
    if (idValue === null || idValue === undefined || String(idValue).trim() === "") {
      return true;
    }
  }

  return false;
}

function mapRowToUnifiedSchema(row, propertyCode, config) {
  const cm = config.column_map;

  const rawReservationId = getCol(row, cm.reservation_id);
  if (rawReservationId === null || rawReservationId === undefined || rawReservationId === "") {
    return null;
  }

  // Real-world quirk (Crystal Sands): status isn't a column, it's a suffix
  // on the reservation number itself — "2122 - Amended", "2024 - CXLD".
  // Strip the suffix to get the base ID, and derive status from it when
  // configured. Falls back to a normal status column otherwise.
  const { baseId, statusFromSuffix } = splitReservationIdSuffix(
    String(rawReservationId).trim(),
    config.status_from_id_suffix
  );

  const arrival = parseDate(getCol(row, cm.guest_arrival_date), config);
  const departure = parseDate(getCol(row, cm.guest_departure_date), config);
  const bookingDate = cm.booking_date ? parseDate(getCol(row, cm.booking_date), config) : null;
  const pickupDate = config.pickup_date_column
    ? parseDate(getCol(row, config.pickup_date_column), config)
    : bookingDate;
  const periodMonth = cm.period_month ? parseMonth(getCol(row, cm.period_month), config) : null;

  const sourceNights = cm.nights ? toNumber(getCol(row, cm.nights)) : null;
  const nights = sourceNights ?? (arrival && departure ? dayjs(departure).diff(dayjs(arrival), "day") : null);

  const roomRevenue = cm.room_revenue ? toNumber(getCol(row, cm.room_revenue)) : null;
  const fnbRevenue = cm.fnb_revenue ? toNumber(getCol(row, cm.fnb_revenue)) : null;
  const totalRevenue = toNumber(getCol(row, cm.total_revenue));

  let status;
  if (statusFromSuffix) {
    status = statusFromSuffix;
  } else if (cm.status) {
    const rawStatus = String(getCol(row, cm.status) ?? "").trim();
    status = mapStatus(rawStatus, config.status_map);
  } else {
    // No status column and no suffix match: a negative total_revenue is a
    // strong signal this is an adjustment/reversal row rather than a fresh
    // confirmed booking — flag as unknown rather than guessing "confirmed".
    status = totalRevenue !== null && totalRevenue < 0 ? "unknown" : "confirmed";
  }

  const channel = cm.channel ? getCol(row, cm.channel) : null;
  const segment = cm.segment ? getCol(row, cm.segment) : null;

  return {
    reservation_id: baseId,
    property_code: propertyCode,
    guest_arrival_date: arrival,
    guest_departure_date: departure,
    booking_date: bookingDate,
    pickup_date: pickupDate,
    period_month: periodMonth,
    nights,
    room_revenue: roomRevenue,
    fnb_revenue: fnbRevenue,
    other_revenue: null,
    total_revenue: totalRevenue,
    currency: config.currency,
    status,
    channel,
    segment,
    is_quarantined: false,
    quarantine_reason: null,
  };
}

/**
 * Splits a reservation ID like "2122 - Amended" or "2024 - CXLD" into its
 * base ID and a derived status, using the property's configured suffix map.
 * Returns { baseId, statusFromSuffix: null } unchanged if no suffix matches
 * or the property doesn't use this pattern.
 */
function splitReservationIdSuffix(rawId, suffixMap) {
  if (!suffixMap) return { baseId: rawId, statusFromSuffix: null };

  const match = rawId.match(/^(.+?)\s*-\s*(.+)$/);
  if (!match) return { baseId: rawId, statusFromSuffix: null };

  const [, base, suffix] = match;
  for (const [normalized, variants] of Object.entries(suffixMap)) {
    if (variants.some((v) => v.toLowerCase() === suffix.trim().toLowerCase())) {
      // "confirmed_amended" isn't a real clean_reservations status value —
      // amendments are still confirmed bookings, just changed. Map it down
      // to "confirmed" for storage; the raw suffix is preserved in the raw
      // layer (raw_row JSONB) for anyone who needs to see it was amended.
      const storedStatus = normalized === "confirmed_amended" ? "confirmed" : normalized;
      return { baseId: base.trim(), statusFromSuffix: storedStatus };
    }
  }
  return { baseId: rawId, statusFromSuffix: null };
}

function getCol(row, columnName) {
  if (!columnName) return null;
  return row[columnName] ?? null;
}

/**
 * Tries each format in config.date_formats (falling back to the single
 * config.date_format for properties that don't need multi-format support)
 * until one parses. Real workbooks have been observed mixing M/D/YYYY and
 * D/M/YYYY within the same column, so a single fixed format silently
 * mis-parses some rows rather than failing loudly — trying multiple
 * formats and taking the first valid one is the safer default here.
 */
function parseDate(value, config) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    const parsed = excelDateParser?.parse_date_code(value);
    if (!parsed) return null;
    return dayjs(new Date(parsed.y, parsed.m - 1, parsed.d)).format("YYYY-MM-DD");
  }

  // dayjs strict parsing needs both padded and unpadded token variants —
  // "D/M/YYYY" alone fails on a zero-padded value like "30/01/2024", and
  // "DD/MM/YYYY" alone fails on an unpadded one like "1/1/2024". If a
  // property only configured one fixed format, still try all four common
  // combinations rather than trusting it blindly — a config that looks
  // reasonable can still silently drop half its rows otherwise.
  // Order matters for ambiguous dates (e.g. "5/3/2024" — day-5 or month-5?).
  // Default to DD/MM/YYYY first since these are Sri Lankan properties, but
  // this is a genuine ambiguity dayjs can't resolve for us — if a property's
  // dates turn out backwards after ingestion, that's a sign to add an
  // explicit date_formats entry for it rather than trust this default order.
  const DEFAULT_FORMATS = ["D/M/YYYY", "DD/MM/YYYY", "M/D/YYYY", "MM/DD/YYYY"];
  const formats = config.date_formats || (config.date_format ? [config.date_format, ...DEFAULT_FORMATS] : DEFAULT_FORMATS);
  const raw = String(value).trim();

  for (const fmt of formats) {
    const parsed = dayjs(raw, fmt, true);
    if (parsed.isValid()) return parsed.format("YYYY-MM-DD");
  }
  return null;
}

function parseMonth(value, config) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    const parsed = excelDateParser?.parse_date_code(value);
    if (!parsed) return null;
    return dayjs(new Date(parsed.y, parsed.m - 1, 1)).format("YYYY-MM-DD");
  }

  const raw = String(value).trim();
  const formats = config.month_formats || ["MMM-YY", "MMM-YYYY", "MMMM-YY", "MMMM-YYYY", "YYYY-MM"];

  for (const fmt of formats) {
    const parsed = dayjs(raw, fmt, true);
    if (parsed.isValid()) return parsed.startOf("month").format("YYYY-MM-DD");
  }

  const dateParsed = parseDate(raw, config);
  return dateParsed ? dayjs(dateParsed).startOf("month").format("YYYY-MM-DD") : null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function mapStatus(rawStatus, statusMap) {
  if (!statusMap) return "unknown";
  for (const [normalized, variants] of Object.entries(statusMap)) {
    if (variants.some((v) => v.toLowerCase() === rawStatus.toLowerCase())) {
      return normalized;
    }
  }
  return "unknown";
}
