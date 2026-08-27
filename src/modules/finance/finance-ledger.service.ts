import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

export interface LedgerBalances {
  balanceBefore: number;
  balanceAfter: number;
}

interface LedgerEntry {
  id: string;
  signedAmount: number;
  currency: string;
  transactionDate: Date;
  createdAt: Date;
}

/**
 * Single authoritative source of "what was the balance before/after this transaction" for the
 * whole Finance module — the history list, single-item get, create, and update responses all
 * go through this, so no screen or endpoint can compute a different number.
 *
 * Design: dynamic reconstruction (Option A), not persisted balanceBefore/balanceAfter columns.
 * This project has no Account/Wallet/opening-balance model anywhere in the schema (confirmed by
 * grep before writing this) — "balance" has never been an explicit stored concept, only ever an
 * implicit sum of Income minus Expense. Persisting snapshot columns would require rewriting every
 * later transaction's stored balance on every edit/delete/backdated insert (a cascading multi-row
 * write on every mutation, with real risk of the chain drifting out of sync under a partial
 * failure). Recomputing fresh from the transactions themselves on every read means edits, deletes,
 * and backdated inserts are automatically correct with no extra code at all — there is nothing to
 * keep in sync because nothing is cached. This mirrors the same "derive at read time, never store
 * a derived value" pattern already used elsewhere in this codebase (ingredient stockStatus, BMI,
 * recurring-expense occurrence status).
 *
 * Per-currency: balances for TWD/VND/USD/etc. are independent ledgers (no exchange-rate
 * conversion system exists in this project — see finance.service.ts's cashflow forecast, which
 * already groups by currency for the same reason). There is no opening balance to seed from, so
 * each currency's ledger starts at 0 before its earliest transaction.
 */
@Injectable()
export class FinanceLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Computes balanceBefore/balanceAfter for every income and expense the user has ever recorded,
   * keyed by transaction id. Two queries total (all incomes, all expenses) regardless of how many
   * rows are being displayed — not N+1, and safe to call once per request.
   */
  async computeBalances(userId: string): Promise<Map<string, LedgerBalances>> {
    const [incomes, expenses] = await Promise.all([
      this.prisma.income.findMany({
        where: { userId },
        select: { id: true, amount: true, currency: true, receivedDate: true, createdAt: true },
      }),
      this.prisma.expense.findMany({
        where: { userId },
        select: { id: true, amount: true, currency: true, expenseDate: true, createdAt: true },
      }),
    ]);

    const entries: LedgerEntry[] = [
      ...incomes.map((i) => ({ id: i.id, signedAmount: i.amount, currency: i.currency, transactionDate: i.receivedDate, createdAt: i.createdAt })),
      ...expenses.map((e) => ({ id: e.id, signedAmount: -e.amount, currency: e.currency, transactionDate: e.expenseDate, createdAt: e.createdAt })),
    ];

    const byCurrency = new Map<string, LedgerEntry[]>();
    for (const entry of entries) {
      const list = byCurrency.get(entry.currency) ?? [];
      list.push(entry);
      byCurrency.set(entry.currency, list);
    }

    const result = new Map<string, LedgerBalances>();
    for (const list of byCurrency.values()) {
      // Deterministic chronological order: transaction date, then creation timestamp (same-day
      // transactions), then id (final tiebreaker for truly identical timestamps) — the balance
      // chain must never depend on database/query return order.
      list.sort((a, b) => {
        const dateDiff = a.transactionDate.getTime() - b.transactionDate.getTime();
        if (dateDiff !== 0) return dateDiff;
        const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
        if (createdDiff !== 0) return createdDiff;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

      let running = 0;
      for (const entry of list) {
        const balanceBefore = running;
        running += entry.signedAmount;
        result.set(entry.id, { balanceBefore, balanceAfter: running });
      }
    }

    return result;
  }
}
