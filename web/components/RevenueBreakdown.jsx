import MetricCardGroup from "./MetricCardGroup";

function numberValue(value) {
  return Number(value || 0);
}

function totalsFromProperties(properties) {
  return {
    currency: properties[0]?.currency || "LKR",
    roomRevenue: properties.reduce((sum, row) => sum + numberValue(row.room_revenue ?? row.actual_revenue), 0),
    fnbRevenue: properties.reduce((sum, row) => sum + numberValue(row.fnb_revenue), 0),
    totalBookingValue: properties.reduce(
      (sum, row) => sum + numberValue(row.total_booking_value || numberValue(row.actual_revenue) + numberValue(row.fnb_revenue)),
      0
    ),
  };
}

export default function RevenueBreakdown({ properties, title = "Overall revenue", caption }) {
  const totals = totalsFromProperties(properties);

  return (
    <MetricCardGroup
      eyebrow="Overall"
      title={title}
      caption={caption}
      currency={totals.currency}
      items={[
        { label: "Room revenue", value: totals.roomRevenue },
        { label: "Meal / FNB charges", value: totals.fnbRevenue },
        { label: "Total booking value", value: totals.totalBookingValue },
      ]}
    />
  );
}
