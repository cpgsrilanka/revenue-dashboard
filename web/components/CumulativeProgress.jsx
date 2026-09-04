"use client";

import DataTableFrame from "./DataTableFrame";
import SectionHeader from "./SectionHeader";

function numberValue(value) {
  return Number(value || 0);
}

function formatCurrency(value, currency = "LKR") {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numberValue(value));
}

function formatFullMonth(value) {
  return new Intl.DateTimeFormat("en-LK", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export default function CumulativeProgress({ rows, periodLabel, scopeLabel, note }) {
  if (!rows?.length) return null;

  const currency = rows[0]?.currency || "LKR";
  const final = rows[rows.length - 1];
  const actual = numberValue(final.cumulativeActual);
  const budget = numberValue(final.cumulativeBudget);
  const variance = numberValue(final.cumulativeVariance ?? actual - budget);
  const balanceToEarn = budget - actual;
  const achievement = budget ? (actual / budget) * 100 : 0;
  const progress = Math.max(0, Math.min(100, achievement));

  return (
    <section className="mb-8">
      <SectionHeader
        eyebrow="Budget performance"
        title="Cumulative progress"
        subtitle={`${scopeLabel} across ${periodLabel}. Actual room revenue including taxes against the selected period budget.`}
        action={note}
      />

      <div className="rounded-lg border border-line bg-white/55 p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-lg border border-line bg-line">
          <div className="bg-white/70 px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-slate">Actual earned</p>
            <p className="font-display text-2xl mt-1 tabular-nums">{formatCurrency(actual, currency)}</p>
          </div>
          <div className="bg-white/70 px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-slate">Budget target</p>
            <p className="font-display text-2xl mt-1 tabular-nums">{formatCurrency(budget, currency)}</p>
          </div>
          <div className="bg-white/70 px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-slate">
              {balanceToEarn > 0 ? "Balance to earn" : "Ahead of budget"}
            </p>
            <p className={`font-display text-2xl mt-1 tabular-nums ${balanceToEarn > 0 ? "text-brick" : "text-brass"}`}>
              {formatCurrency(Math.abs(balanceToEarn), currency)}
            </p>
          </div>
          <div className="bg-white/70 px-5 py-4">
            <p className="text-xs uppercase tracking-wide text-slate">Revenue achievement</p>
            <p className="font-display text-2xl mt-1 tabular-nums">{achievement.toFixed(1)}%</p>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs text-slate mb-2">
            <span>Progress to budget</span>
            <span className="tabular-nums">{formatCurrency(variance, currency)} variance</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-line">
            <div
              className={`h-full rounded-full ${achievement >= 100 ? "bg-brass" : "bg-ink"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <details className="mt-4 rounded-lg border border-line bg-white/55">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">
          Monthly audit
        </summary>
        <DataTableFrame className="rounded-none border-x-0 border-b-0">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-sky-50 text-left text-xs uppercase tracking-wide text-slate border-b border-line">
                <th className="px-4 py-3 font-medium">Month</th>
                <th className="px-4 py-3 font-medium text-right">Actual</th>
                <th className="px-4 py-3 font-medium text-right">Budget</th>
                <th className="px-4 py-3 font-medium text-right">Monthly balance</th>
                <th className="px-4 py-3 font-medium text-right">Running balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const monthlyBalance = numberValue(row.variance);
                const runningBalance = numberValue(row.cumulativeVariance);

                return (
                  <tr key={row.period_month} className="border-b border-line last:border-b-0 odd:bg-white/45">
                    <td className="px-4 py-3 font-medium">{formatFullMonth(row.period_month)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(row.actual, currency)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(row.budget, currency)}</td>
                    <td className={`px-4 py-3 text-right tabular-nums ${monthlyBalance >= 0 ? "text-brass" : "text-brick"}`}>
                      {formatCurrency(monthlyBalance, currency)}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${runningBalance >= 0 ? "text-brass" : "text-brick"}`}>
                      {formatCurrency(runningBalance, currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTableFrame>
      </details>
    </section>
  );
}
