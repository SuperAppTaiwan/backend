/**
 * Shared currency-grouping helpers for the Finance module. No exchange-rate/conversion system
 * exists in this app (see finance-ledger.service.ts's file header) — every aggregate the Finance
 * module reports (monthly totals, trends, forecasts) must be computed independently per
 * currency, never summed across currencies. This file is the single place that grouping logic
 * lives so finance.service.ts and ai.service.ts can't drift into two different implementations.
 */

/** Sums `getAmount(item)` per distinct `getCurrency(item)`, e.g. turning a mixed-currency list
 * of transactions into `{ VND: 500000, TWD: 3000 }`. */
export function sumByCurrency<T>(
  items: T[],
  getAmount: (item: T) => number,
  getCurrency: (item: T) => string,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const currency = getCurrency(item);
    result[currency] = (result[currency] ?? 0) + getAmount(item);
  }
  return result;
}

/** Groups a mixed-currency list into one array per distinct currency. */
export function groupByCurrency<T>(items: T[], getCurrency: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const currency = getCurrency(item);
    const list = result.get(currency);
    if (list) list.push(item);
    else result.set(currency, [item]);
  }
  return result;
}

/** Keeps only the items matching one specific currency — for call sites that already know
 * which single currency they care about (e.g. scoping a budget's expense total to the budget's
 * own currency), rather than needing the full group-by-every-currency breakdown. */
export function filterByCurrency<T>(items: T[], currency: string, getCurrency: (item: T) => string): T[] {
  return items.filter((item) => getCurrency(item) === currency);
}
