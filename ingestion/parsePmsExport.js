import * as XLSX from "xlsx";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import { XMLParser } from "fast-xml-parser";

dayjs.extend(customParseFormat);

const excelDateParser = XLSX.SSF || XLSX.default?.SSF;

const STATUS_MAPS = {
  opera_xml: {
    confirmed: ["CON", "RES", "DUEIN", "CKIN", "INH"],
    cancelled: ["CXL", "CANCELLED"],
    no_show: ["NS", "NOSHOW", "NO SHOW"],
    checked_out: ["CKOT", "CHECKED OUT"],
  },
  exely_xlsx: {
    confirmed: ["ACTIVE", "CONFIRMED", "CHECKED IN"],
    cancelled: ["CANCELLED", "CANCELED"],
    no_show: ["NO SHOW", "NOSHOW"],
    checked_out: ["CHECKED OUT"],
  },
  hoteltime_xlsx: {
    confirmed: ["CONFIRMED", "CHECK-IN", "CHECKED IN"],
    cancelled: ["CANCELLED", "CANCELED"],
    no_show: ["NO SHOW", "NOSHOW"],
    checked_out: ["CHECK-OUT", "CHECKED OUT"],
  },
};

/**
 * Parses a PMS export into the same rawRows / cleanRows / parseErrors contract
 * used by the existing workbook parser. The property config selects the adapter.
 */
export function parsePmsExport(buffer, propertyCode, config) {
  const adapter = config.pms?.adapter;
  if (!adapter) throw new Error(`${propertyCode}: missing pms.adapter configuration.`);

  if (adapter === "opera_xml") return parseOperaXml(buffer, propertyCode, config);
  if (adapter === "exely_xlsx") return parseExelyWorkbook(buffer, propertyCode, config);
  if (adapter === "hoteltime_xlsx") return parseHotelTimeWorkbook(buffer, propertyCode, config);

  throw new Error(`${propertyCode}: unsupported PMS adapter "${adapter}".`);
}

function parseOperaXml(buffer, propertyCode, config) {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
  });
  const document = parser.parse(buffer.toString("utf8"));
  const groups = toArray(document.RES_DETAIL?.LIST_G_GROUP_BY1?.G_GROUP_BY1);
  const reservations = groups.flatMap((group) =>
    toArray(group.LIST_G_RESERVATION?.G_RESERVATION)
  );

  if (!reservations.length) {
    throw new Error(`${propertyCode}: OPERA XML contains no G_RESERVATION records.`);
  }

  return mapRows(reservations, propertyCode, config, "opera_xml", (row) => {
    const status = mapStatus(value(row, "SHORT_RESV_STATUS"), "opera_xml");
    const arrival = parseDate(field(row, "ARRIVAL"));
    const departure = parseDate(field(row, "DEPARTURE"));
    const rooms = number(field(row, "NO_OF_ROOMS")) ?? 1;
    const sourceRecordId = value(row, "RESV_NAME_ID");

    if (!sourceRecordId) throw new Error("Missing RESV_NAME_ID.");

    return buildCleanRow({
      propertyCode,
      config,
      sourceSystem: "opera",
      sourceRecordId,
      reservationId: value(row, "CONFIRMATION_NO") || sourceRecordId,
      sourceUpdatedAt: parseDate(field(row, "UPDATE_DATE")),
      arrival,
      departure,
      rooms,
      status,
      currency: value(row, "CURRENCY_CODE") || config.currency,
      sourceRateAmount: number(field(row, "EFFECTIVE_RATE_AMOUNT")),
      depositPaid: number(field(row, "DEPOSIT_PAID")),
      channel: value(row, "ORIGIN_OF_BOOKING"),
      segment: value(row, "MARKET_CODE"),
      raw: pick(row, [
        "RESV_NAME_ID",
        "CONFIRMATION_NO",
        "RESORT",
        "UPDATE_DATE",
        "SHORT_RESV_STATUS",
        "ARRIVAL",
        "DEPARTURE",
        "NO_OF_ROOMS",
        "ROOM_CATEGORY_LABEL",
        "ROOM_NO",
        "MARKET_CODE",
        "ORIGIN_OF_BOOKING",
        "RATE_CODE",
        "CURRENCY_CODE",
        "EFFECTIVE_RATE_AMOUNT",
        "DEPOSIT_PAID",
      ]),
    });
  });
}

function parseExelyWorkbook(buffer, propertyCode, config) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const reportSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!reportSheet) throw new Error(`${propertyCode}: Exely workbook has no report sheet.`);

  const rows = XLSX.utils.sheet_to_json(reportSheet, { defval: null, raw: true });
  return mapRows(rows, propertyCode, config, "exely_xlsx", (row) => {
    const sourceRecordId = value(row, "Booking No.");
    if (!sourceRecordId) throw new Error("Missing Booking No.");

    const status = mapStatus(value(row, "Booking status"), "exely_xlsx");
    return buildCleanRow({
      propertyCode,
      config,
      sourceSystem: "exely",
      sourceRecordId,
      reservationId: sourceRecordId,
      bookingDate: parseDate(field(row, "Booking date")),
      arrival: parseDate(field(row, "Check-in date")),
      departure: parseDate(field(row, "Departure date")),
      rooms: number(field(row, "Rooms")) ?? 1,
      status,
      currency: config.currency,
      roomRevenue: number(field(row, "Total amount")),
      totalRevenue: number(field(row, "Total amount")),
      depositPaid: number(field(row, "Prepaid amount")),
      channel: value(row, "Point of sale") || value(row, "Reference source"),
      segment: value(row, "Agent's rate plan"),
      raw: pick(row, [
        "External number",
        "Booking No.",
        "Rooms",
        "Total amount",
        "Required prepayment",
        "Prepaid amount",
        "Prepayment less partial refund",
        "Payment method",
        "Booking date",
        "Cancellation date",
        "Check-in date",
        "Nights",
        "Departure date",
        "Point of sale",
        "Reference source",
        "Booking status",
        "Accommodation property",
        "Room type",
        "Cancellation reason",
        "Agent's rate plan",
      ]),
    });
  });
}

function parseHotelTimeWorkbook(buffer, propertyCode, config) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = config.pms?.sheet_name || "export";
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(
      `${propertyCode}: HotelTime sheet "${sheetName}" was not found. Available sheets: ${workbook.SheetNames.join(", ")}`
    );
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  return mapRows(rows, propertyCode, config, "hoteltime_xlsx", (row) => {
    const reservationId = value(row, "Reservation number");
    const arrival = parseDate(field(row, "Arrival"));
    const departure = parseDate(field(row, "Departure"));
    const room = value(row, "Room");
    const roomType = value(row, "Room type");
    const sourceRecordId = [reservationId, arrival, departure, room, roomType].join("|");

    if (!reservationId || !arrival || !departure) {
      throw new Error("Missing Reservation number, Arrival, or Departure.");
    }

    const status = mapStatus(value(row, "State"), "hoteltime_xlsx");
    return buildCleanRow({
      propertyCode,
      config,
      sourceSystem: "hoteltime",
      sourceRecordId,
      reservationId,
      bookingDate: parseDate(field(row, "Created")),
      arrival,
      departure,
      rooms: 1,
      stayNights: number(field(row, "Nights")),
      status,
      currency: value(row, "Currency") || config.currency,
      roomRevenue: number(field(row, "Total for accommodation")),
      totalRevenue: number(field(row, "Total inc. VAT *1)")),
      outstandingBalance: number(field(row, "Unpaid *1)")),
      sourceRateAmount: number(field(row, "ARR *2)")),
      channel: value(row, "Reservation source"),
      segment: value(row, "Segment"),
      raw: pick(row, [
        "Reservation number",
        "Room type",
        "Room",
        "Reservation owner:",
        "Agent",
        "Client type",
        "Segment",
        "Reservation source",
        "RateCode",
        "Arrival",
        "Departure",
        "Created",
        "State",
        "Persons",
        "Nights",
        "ARR *2)",
        "Total for accommodation",
        "Total inc. VAT *1)",
        "Unpaid *1)",
        "Currency",
      ]),
    });
  });
}

function mapRows(rows, propertyCode, config, adapter, mapper) {
  const rawRows = [];
  const cleanRows = [];
  const parseErrors = [];

  rows.forEach((row, index) => {
    const sourceRowNumber = index + 2;
    try {
      const { raw, clean } = mapper(row);
      rawRows.push({ sourceRowNumber, sheetName: adapter, data: raw });
      cleanRows.push({ sourceRowNumber, sheetName: adapter, data: clean });
    } catch (error) {
      parseErrors.push({
        sourceRowNumber,
        sheetName: adapter,
        reason: error.message,
        rawRow: { adapter, source_row_number: sourceRowNumber },
      });
    }
  });

  return { rawRows, cleanRows, parseErrors };
}

function buildCleanRow({
  propertyCode,
  config,
  sourceSystem,
  sourceRecordId,
  reservationId,
  sourceUpdatedAt = null,
  bookingDate = null,
  arrival,
  departure,
  rooms,
  stayNights = null,
  status,
  currency,
  roomRevenue = null,
  totalRevenue = null,
  sourceRateAmount = null,
  depositPaid = null,
  outstandingBalance = null,
  channel = null,
  segment = null,
  raw,
}) {
  const derivedStayNights = stayNights ?? nightsBetween(arrival, departure);
  const operationalZero = status === "cancelled" || status === "no_show";
  const rateOnly = config.pms?.revenue_mode === "rate_only";

  return {
    raw,
    clean: {
      reservation_id: reservationId,
      property_code: propertyCode,
      source_system: sourceSystem,
      source_record_id: sourceRecordId,
      source_updated_at: sourceUpdatedAt,
      booking_date: bookingDate,
      pickup_date: bookingDate,
      guest_arrival_date: arrival,
      guest_departure_date: departure,
      period_month: arrival ? dayjs(arrival).startOf("month").format("YYYY-MM-DD") : null,
      nights: operationalZero ? 0 : Math.max(0, (rooms || 1) * (derivedStayNights || 0)),
      room_revenue: operationalZero ? 0 : rateOnly ? null : roomRevenue,
      fnb_revenue: null,
      other_revenue: null,
      total_revenue: operationalZero ? 0 : rateOnly ? null : totalRevenue,
      currency: currency || config.currency,
      status,
      channel: channel || null,
      segment: segment || null,
      source_rate_amount: sourceRateAmount,
      source_deposit_paid: depositPaid,
      source_outstanding_balance: outstandingBalance,
      is_quarantined: false,
      quarantine_reason: null,
    },
  };
}

function mapStatus(rawStatus, adapter) {
  const raw = String(rawStatus || "").trim().toUpperCase();
  for (const [normalized, values] of Object.entries(STATUS_MAPS[adapter])) {
    if (values.includes(raw)) return normalized;
  }
  return "unknown";
}

function parseDate(input) {
  if (input === null || input === undefined || input === "") return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) return dayjs(input).format("YYYY-MM-DD");
  if (typeof input === "number") {
    const parsed = excelDateParser?.parse_date_code(input);
    return parsed ? dayjs(new Date(parsed.y, parsed.m - 1, parsed.d)).format("YYYY-MM-DD") : null;
  }

  const valueToParse = String(input)
    .trim()
    .replace(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/g, (month) =>
      `${month[0]}${month.slice(1).toLowerCase()}`
    );
  const formats = [
    "YYYY-MM-DD HH:mm:ss",
    "YYYY-MM-DD",
    "DD-MMM-YY",
    "D-MMM-YY",
    "DD/MM/YYYY",
    "D/M/YYYY",
    "DD/MM/YY",
    "D/M/YY",
    "DD-MM-YYYY",
    "D-M-YYYY",
    "DD-MM-YY",
    "D-M-YY",
  ];
  for (const format of formats) {
    const parsed = dayjs(valueToParse, format, true);
    if (parsed.isValid()) return parsed.format("YYYY-MM-DD");
  }
  return null;
}

function nightsBetween(arrival, departure) {
  if (!arrival || !departure) return null;
  return dayjs(departure).diff(dayjs(arrival), "day");
}

function number(input) {
  if (input === null || input === undefined || input === "") return null;
  const parsed = typeof input === "number" ? input : Number(String(input).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function value(row, field) {
  const input = fieldValue(row, field);
  return input === null || input === undefined ? "" : String(input).trim();
}

function field(row, fieldName) {
  return fieldValue(row, fieldName);
}

function fieldValue(row, fieldName) {
  return row[fieldName];
}

function pick(row, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => Object.prototype.hasOwnProperty.call(row, field))
      .map((field) => [field, row[field]])
  );
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
