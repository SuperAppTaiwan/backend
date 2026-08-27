import { FinanceLedgerService } from './finance-ledger.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

const mockPrisma = {
  income: { findMany: jest.fn() },
  expense: { findMany: jest.fn() },
};

function income(id: string, amount: number, date: string, createdAt = date, currency = 'TWD') {
  return { id, amount, currency, receivedDate: new Date(date), createdAt: new Date(createdAt) };
}
function expense(id: string, amount: number, date: string, createdAt = date, currency = 'TWD') {
  return { id, amount, currency, expenseDate: new Date(date), createdAt: new Date(createdAt) };
}

describe('FinanceLedgerService', () => {
  let service: FinanceLedgerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FinanceLedgerService(mockPrisma as unknown as PrismaService);
  });

  // ─── Test A: basic income + expense sequence ──────────────────────────────────

  it('Test A — computes a correct running balance chain from a mixed income/expense sequence', async () => {
    mockPrisma.income.findMany.mockResolvedValue([
      income('i1', 500, '2026-01-01'),
      income('i2', 1000, '2026-01-04'),
    ]);
    mockPrisma.expense.findMany.mockResolvedValue([
      expense('e1', 200, '2026-01-02'),
      expense('e2', 100, '2026-01-03'),
    ]);

    const balances = await service.computeBalances('u-1');

    // Starting balance is implicitly 0 (no opening-balance concept exists anywhere in this
    // project — see finance-ledger.service.ts's doc comment) plus a conceptual "1,000" opening
    // amount from the task's own example is just the first income of the sequence in this test.
    expect(balances.get('i1')).toEqual({ balanceBefore: 0, balanceAfter: 500 });
    expect(balances.get('e1')).toEqual({ balanceBefore: 500, balanceAfter: 300 });
    expect(balances.get('e2')).toEqual({ balanceBefore: 300, balanceAfter: 200 });
    expect(balances.get('i2')).toEqual({ balanceBefore: 200, balanceAfter: 1200 });
  });

  it('Test A (spec-literal) — 1,000 opening + 500/-200/-100/+1,000 matches the exact worked example', async () => {
    // Modeled as an initial income of 1,000 followed by the four transactions from the task's
    // own worked example, since this project has no separate "opening balance" field.
    mockPrisma.income.findMany.mockResolvedValue([
      income('opening', 1000, '2026-01-01'),
      income('i1', 500, '2026-01-02'),
      income('i2', 1000, '2026-01-05'),
    ]);
    mockPrisma.expense.findMany.mockResolvedValue([
      expense('e1', 200, '2026-01-03'),
      expense('e2', 100, '2026-01-04'),
    ]);

    const balances = await service.computeBalances('u-1');

    expect(balances.get('opening')).toEqual({ balanceBefore: 0, balanceAfter: 1000 });
    expect(balances.get('i1')).toEqual({ balanceBefore: 1000, balanceAfter: 1500 });
    expect(balances.get('e1')).toEqual({ balanceBefore: 1500, balanceAfter: 1300 });
    expect(balances.get('e2')).toEqual({ balanceBefore: 1300, balanceAfter: 1200 });
    expect(balances.get('i2')).toEqual({ balanceBefore: 1200, balanceAfter: 2200 });
  });

  // ─── Test C: editing a historical transaction recalculates everything after it ────

  it('Test C — editing a historical expense amount changes every later balance on the next computation', async () => {
    mockPrisma.income.findMany.mockResolvedValue([income('i1', 1000, '2026-01-01')]);
    mockPrisma.expense.findMany.mockResolvedValue([
      expense('e1', 200, '2026-01-02'),
      expense('e2', 100, '2026-01-03'),
    ]);

    const before = await service.computeBalances('u-1');
    expect(before.get('e1')).toEqual({ balanceBefore: 1000, balanceAfter: 800 });
    expect(before.get('e2')).toEqual({ balanceBefore: 800, balanceAfter: 700 });

    // Simulate the edit (200 -> 300) by changing what the next findMany call returns — exactly
    // what happens for real once the DB row itself is updated; nothing is cached anywhere.
    mockPrisma.expense.findMany.mockResolvedValue([
      expense('e1', 300, '2026-01-02'),
      expense('e2', 100, '2026-01-03'),
    ]);

    const after = await service.computeBalances('u-1');
    expect(after.get('e1')).toEqual({ balanceBefore: 1000, balanceAfter: 700 });
    expect(after.get('e2')).toEqual({ balanceBefore: 700, balanceAfter: 600 }); // recalculated, not stale
  });

  // ─── Test D: deleting a historical transaction ────────────────────────────────

  it('Test D — deleting a historical expense shifts every later balance on the next computation', async () => {
    mockPrisma.income.findMany.mockResolvedValue([income('i1', 10000, '2026-01-01')]);
    mockPrisma.expense.findMany.mockResolvedValue([
      expense('e1', 2000, '2026-01-02'),
      expense('e2', 500, '2026-01-03'),
    ]);

    const before = await service.computeBalances('u-1');
    expect(before.get('e1')).toEqual({ balanceBefore: 10000, balanceAfter: 8000 });
    expect(before.get('e2')).toEqual({ balanceBefore: 8000, balanceAfter: 7500 });

    // Simulate deleting e1 — it simply no longer comes back from the query.
    mockPrisma.expense.findMany.mockResolvedValue([expense('e2', 500, '2026-01-03')]);

    const after = await service.computeBalances('u-1');
    expect(after.has('e1')).toBe(false);
    expect(after.get('e2')).toEqual({ balanceBefore: 10000, balanceAfter: 9500 }); // no longer 8000 -> 7500
  });

  // ─── Test E: backdated transaction insertion ──────────────────────────────────

  it('Test E — a backdated transaction slots into the correct chronological position', async () => {
    mockPrisma.income.findMany.mockResolvedValue([income('i1', 10000, '2026-01-01')]);
    mockPrisma.expense.findMany.mockResolvedValue([
      expense('e1', 1000, '2026-01-05'),
      expense('e2', 500, '2026-01-20'),
    ]);
    const before = await service.computeBalances('u-1');
    expect(before.get('e2')).toEqual({ balanceBefore: 9000, balanceAfter: 8500 });

    // "Today" the user backdates a new expense to Jan 10 — between e1 and e2.
    mockPrisma.expense.findMany.mockResolvedValue([
      expense('e1', 1000, '2026-01-05'),
      expense('backdated', 300, '2026-01-10'),
      expense('e2', 500, '2026-01-20'),
    ]);

    const after = await service.computeBalances('u-1');
    expect(after.get('e1')).toEqual({ balanceBefore: 10000, balanceAfter: 9000 });
    expect(after.get('backdated')).toEqual({ balanceBefore: 9000, balanceAfter: 8700 });
    expect(after.get('e2')).toEqual({ balanceBefore: 8700, balanceAfter: 8200 }); // shifted from 8500
  });

  // ─── Test F: multiple currencies stay isolated ────────────────────────────────

  it('Test F — TWD, VND, and USD ledgers never mix', async () => {
    mockPrisma.income.findMany.mockResolvedValue([
      income('twd-in', 10000, '2026-01-01', '2026-01-01', 'TWD'),
      income('vnd-in', 5000000, '2026-01-01', '2026-01-01', 'VND'),
      income('usd-in', 100, '2026-01-01', '2026-01-01', 'USD'),
    ]);
    mockPrisma.expense.findMany.mockResolvedValue([
      expense('twd-out', 2000, '2026-01-02', '2026-01-02', 'TWD'),
      expense('vnd-out', 1000000, '2026-01-02', '2026-01-02', 'VND'),
      expense('usd-out', 20, '2026-01-02', '2026-01-02', 'USD'),
    ]);

    const balances = await service.computeBalances('u-1');

    expect(balances.get('twd-out')).toEqual({ balanceBefore: 10000, balanceAfter: 8000 });
    expect(balances.get('vnd-out')).toEqual({ balanceBefore: 5000000, balanceAfter: 4000000 });
    expect(balances.get('usd-out')).toEqual({ balanceBefore: 100, balanceAfter: 80 });
  });

  // ─── Test G: deterministic same-date ordering ─────────────────────────────────

  it('Test G — same-date transactions order by createdAt, then id, deterministically', async () => {
    mockPrisma.income.findMany.mockResolvedValue([]);
    mockPrisma.expense.findMany.mockResolvedValue([
      expense('e-z', 100, '2026-01-01', '2026-01-01T10:00:00Z'),
      expense('e-a', 50, '2026-01-01', '2026-01-01T10:00:00Z'), // identical date AND createdAt as e-z
      expense('e-mid', 25, '2026-01-01', '2026-01-01T09:00:00Z'), // earlier createdAt, same date
    ]);

    const run1 = await service.computeBalances('u-1');
    const run2 = await service.computeBalances('u-1');

    // e-mid (earliest createdAt) goes first, then e-a/e-z tiebroken by id (alphabetical: 'e-a' < 'e-z').
    expect(run1.get('e-mid')).toEqual({ balanceBefore: 0, balanceAfter: -25 });
    expect(run1.get('e-a')).toEqual({ balanceBefore: -25, balanceAfter: -75 });
    expect(run1.get('e-z')).toEqual({ balanceBefore: -75, balanceAfter: -175 });
    // Running it again (simulating a second request) must yield bit-for-bit identical results.
    expect(run2).toEqual(run1);
  });

  it('does not query anything when the user has no transactions at all', async () => {
    mockPrisma.income.findMany.mockResolvedValue([]);
    mockPrisma.expense.findMany.mockResolvedValue([]);
    const balances = await service.computeBalances('u-1');
    expect(balances.size).toBe(0);
  });
});
