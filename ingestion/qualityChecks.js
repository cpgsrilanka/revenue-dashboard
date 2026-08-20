import dayjs from "dayjs";

/**
 * Runs the row-level and file-level data quality checks described in the
 * architecture plan (Section 5). Returns an array of data_quality_log
 * entries ready to insert, and mutates rows in place to mark quarantine.
 */
export function runQualityChecks({ propertyCode, cleanRows, parseErrors, previousFileRowCount }) {
  const findings = [];

  // --- Schema drift: if parseErrors is a large fraction of the file, the
  // column_map probably no longer matches the sheet. Fail loudly rather
  // than silently ingesting garbage.
  const totalRows = cleanRows.length + parseErrors.length;
  if (totalRows > 0 && parseErrors.length / totalRows > 0.1) {
    findings.push({
      property_code: propertyCode,
      check_type: "schema_drift",
      severity: "critical",
      message: `${parseErrors.length}/${totalRows} rows failed to parse — the adapter config's column_map likely no longer matches this file's headers. Check config/properties.yaml for ${propertyCode}.`,
    });
  }

  // --- Completeness: file has zero usable rows
  if (cleanRows.length === 0) {
    findings.push({
      property_code: propertyCode,
      check_type: "completeness",
      severity: "critical",
      message: `No usable reservation rows found in the latest file for ${propertyCode}.`,
    });
  }

  // --- Completeness: row count dropped sharply vs the last ingested file
  if (previousFileRowCount && cleanRows.length < previousFileRowCount * 0.5) {
    findings.push({
      property_code: propertyCode,
      check_type: "completeness",
      severity: "warning",
      message: `Row count dropped from ${previousFileRowCount} to ${cleanRows.length} vs the previous file — confirm this isn't a partial export.`,
    });
  }

  // --- Duplicate detection within this file
  //
  // reservation_id alone is NOT a safe dedup key — confirmed against real
  // data from The Six and Sol House, where a single reservation legitimately
  // spans multiple rows (one per villa/room in a multi-villa booking), and a
  // rebooking to new dates can reuse the SAME reservation_id as the original
  // (shown as a negative cancelled row + a new positive row, same ID).
  // Flagging every repeated reservation_id would quarantine real bookings.
  //
  // A true copy-paste duplicate — the kind actually seen in Crystal Sands'
  // raw data — has identical reservation_id, arrival, departure, AND
  // total_revenue all at once. That combination is what's actually being
  // tested for here, not the ID by itself.
  const seen = new Map();
  for (const { data } of cleanRows) {
    const key = [
      data.reservation_id,
      data.guest_arrival_date,
      data.guest_departure_date,
      data.total_revenue,
    ].join("||");
    if (seen.has(key)) {
      data.is_quarantined = true;
      data.quarantine_reason = "duplicate_row_in_file";
      findings.push({
        property_code: propertyCode,
        check_type: "duplicate",
        severity: "warning",
        message: `Reservation "${data.reservation_id}" appears twice with identical dates and revenue — likely a copy-paste duplicate, not a multi-villa booking or rebooking.`,
        related_reservation_id: data.reservation_id,
      });
    }
    seen.set(key, true);
  }

  // --- Referential / range checks per row
  for (const { data } of cleanRows) {
    if (data.is_quarantined) continue; // already flagged above

    if (
      data.guest_arrival_date &&
      data.guest_departure_date &&
      dayjs(data.guest_departure_date).isBefore(dayjs(data.guest_arrival_date))
    ) {
      data.is_quarantined = true;
      data.quarantine_reason = "departure_before_arrival";
      findings.push({
        property_code: propertyCode,
        check_type: "referential",
        severity: "critical",
        message: `Departure date is before arrival date.`,
        related_reservation_id: data.reservation_id,
      });
      continue;
    }

    if (data.status === "confirmed" || data.status === "checked_out") {
      if (data.total_revenue === null) {
        data.is_quarantined = true;
        data.quarantine_reason = "missing_total_revenue";
        findings.push({
          property_code: propertyCode,
          check_type: "range",
          severity: "warning",
          message: `Confirmed/checked-out reservation has no total_revenue value.`,
          related_reservation_id: data.reservation_id,
        });
        continue;
      }

      if (data.total_revenue < 0) {
        data.is_quarantined = true;
        data.quarantine_reason = "negative_revenue";
        findings.push({
          property_code: propertyCode,
          check_type: "range",
          severity: "critical",
          message: `Negative total_revenue value: ${data.total_revenue}.`,
          related_reservation_id: data.reservation_id,
        });
      }
    }

    if (data.status === "unknown") {
      findings.push({
        property_code: propertyCode,
        check_type: "referential",
        severity: "info",
        message: `Reservation status did not match any known value in status_map — check the raw file's status column.`,
        related_reservation_id: data.reservation_id,
      });
    }
  }

  // Note: cross-check-against-file-total and outlier-vs-trailing-average
  // checks need historical/aggregate context (trailing averages, a
  // property-reported total row) — add these once Phase 2's clean data
  // gives you a baseline to compare against. Wiring the structure now
  // means adding them later is a new function call here, not a redesign.

  return findings;
}
