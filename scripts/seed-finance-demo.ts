/**
 * Finance-specific demo seed — additive and idempotent, safe to re-run.
 *
 * Seeds a realistic, multi-month (August + September), multi-currency (VND/TWD/USD) set of
 * Income/Expense rows for ONE target user, reproducing the exact worked example from the
 * Finance-module bugfix this seed was written to verify:
 *
 *   August ends at 92,000,000 VND -> September +10,000,000 income, -5,000,000 expense
 *   -> current balance 97,000,000 VND, continuous across the calendar-month boundary (never
 *   reset to 0 just because a new month started).
 *
 * VND, TWD, and USD are seeded as fully independent transaction sets so their totals can never
 * be summed together by accident, and a TWD budget + a TWD recurring expense are included so
 * those features have real data to exercise for this user too.
 *
 * DATA SAFETY:
 *  - Talks to the backend over its real HTTP API (never touches Prisma/the database directly),
 *    so every write goes through the exact same validation/ownership/business logic a real
 *    client request would — this is a seed of application data, not a database-level script.
 *  - Only ever touches the ONE user identified by SEED_FINANCE_EMAIL. Never deletes, truncates,
 *    or reseeds any other user's data, and never runs any destructive/reset operation.
 *  - Idempotent: every row this script creates has a note ending in the `[seed-finance-demo]`
 *    marker. A second run detects existing marked rows for this user and exits without
 *    creating duplicates. Pass --force to add a second batch anyway (e.g. to stress-test with
 *    more data) — this still only ever ADDS rows, never deletes/overwrites existing ones.
 *
 * Usage:
 *   SEED_FINANCE_EMAIL=user@example.com SEED_FINANCE_PASSWORD='...' \
 *     pnpm seed:finance-demo
 *
 * Credentials are read from the environment only — never hardcode them here, and never commit
 * a .env/.env.local file containing them.
 */

const API_URL = process.env.SEED_API_URL ?? `http://localhost:${process.env.API_PORT ?? 3000}/api/v1`;
const EMAIL = process.env.SEED_FINANCE_EMAIL;
const PASSWORD = process.env.SEED_FINANCE_PASSWORD;
const FORCE = process.argv.includes('--force');
const MARKER = '[seed-finance-demo]';

if (!EMAIL || !PASSWORD) {
  console.error('Set SEED_FINANCE_EMAIL and SEED_FINANCE_PASSWORD environment variables before running this script.');
  process.exit(1);
}

interface ApiError {
  message?: string | string[];
  statusCode?: number;
}

async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data as ApiError;
    throw new Error(`${opts.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(err?.message ?? data)}`);
  }
  return data as T;
}

interface AuthResponse {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
  user: { id: string; email: string; displayName: string };
}

async function loginOrRegister(): Promise<string> {
  try {
    const { tokens } = await api<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD },
    });
    console.log(`Logged in as existing user ${EMAIL}`);
    return tokens.accessToken;
  } catch (err) {
    console.log(`Login failed (${(err as Error).message}) — attempting to register ${EMAIL} instead`);
    const { tokens } = await api<AuthResponse>('/auth/register', {
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD, displayName: 'Finance Demo' },
    });
    console.log(`Registered new user ${EMAIL}`);
    return tokens.accessToken;
  }
}

interface Income { id: string; note: string | null }
interface Expense { id: string; note: string | null }

async function alreadySeeded(token: string): Promise<boolean> {
  const [incomes, expenses] = await Promise.all([
    api<Income[]>('/finance/incomes', { token }),
    api<Expense[]>('/finance/expenses', { token }),
  ]);
  return (
    incomes.some((i) => i.note?.includes(MARKER)) || expenses.some((e) => e.note?.includes(MARKER))
  );
}

function iso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d, 12)).toISOString();
}

async function createIncome(
  token: string,
  data: { amount: number; currency: string; receivedDate: string; note: string },
) {
  return api('/finance/incomes', { method: 'POST', token, body: { ...data, note: `${data.note} ${MARKER}` } });
}

async function createExpense(
  token: string,
  data: { amount: number; currency: string; expenseDate: string; paymentMethod: string; note: string },
) {
  return api('/finance/expenses', { method: 'POST', token, body: { ...data, note: `${data.note} ${MARKER}` } });
}

async function main() {
  const token = await loginOrRegister();

  if (!FORCE && (await alreadySeeded(token))) {
    console.log('Finance demo data already present for this user — skipping (pass --force to add another batch).');
    return;
  }

  // Use August/September of the current year so the seeded data lines up with "this month" and
  // "last month" regardless of when this script is actually run.
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1; // 1-12, treated as "September" in the comments below
  const prevMonthDate = new Date(curYear, curMonth - 2, 1);
  const prevYear = prevMonthDate.getFullYear();
  const prevMonth = prevMonthDate.getMonth() + 1;

  console.log(`Seeding "last month" = ${prevMonth}/${prevYear}, "this month" = ${curMonth}/${curYear}`);

  // ─── VND: reproduces the exact task-spec worked example ───────────────────────
  // Last month ends at 92,000,000 VND (80,000,000 opening + 45,000,000 income - 15,000,000 rent
  // - 8,000,000 food - 10,000,000 other = +12,000,000 net -> 92,000,000).
  await createIncome(token, { amount: 80000000, currency: 'VND', receivedDate: iso(prevYear, prevMonth, 1), note: 'Số dư đầu kỳ (demo)' });
  await createIncome(token, { amount: 45000000, currency: 'VND', receivedDate: iso(prevYear, prevMonth, 1), note: `Lương tháng ${prevMonth} (demo)` });
  await createExpense(token, { amount: 15000000, currency: 'VND', expenseDate: iso(prevYear, prevMonth, 3), paymentMethod: 'BANK', note: `Tiền thuê nhà tháng ${prevMonth} (demo)` });
  await createExpense(token, { amount: 8000000, currency: 'VND', expenseDate: iso(prevYear, prevMonth, 10), paymentMethod: 'EWALLET', note: `Ăn uống tháng ${prevMonth} (demo)` });
  await createExpense(token, { amount: 10000000, currency: 'VND', expenseDate: iso(prevYear, prevMonth, 25), paymentMethod: 'CARD', note: `Mua sắm tháng ${prevMonth} (demo)` });
  // This month: +10,000,000 income, -5,000,000 expense -> 97,000,000 (never reset to 0).
  await createIncome(token, { amount: 10000000, currency: 'VND', receivedDate: iso(curYear, curMonth, 5), note: `Lương tháng ${curMonth} (demo)` });
  await createExpense(token, { amount: 5000000, currency: 'VND', expenseDate: iso(curYear, curMonth, 10), paymentMethod: 'CASH', note: `Chi tiêu tháng ${curMonth} (demo)` });

  // ─── TWD: fully independent from VND — never summed together ──────────────────
  await createIncome(token, { amount: 15000, currency: 'TWD', receivedDate: iso(prevYear, prevMonth, 1), note: `Học bổng tháng ${prevMonth} (demo)` });
  await createExpense(token, { amount: 6000, currency: 'TWD', expenseDate: iso(prevYear, prevMonth, 5), paymentMethod: 'BANK', note: `Tiền nhà tháng ${prevMonth} (demo)` });
  await createExpense(token, { amount: 4000, currency: 'TWD', expenseDate: iso(prevYear, prevMonth, 15), paymentMethod: 'EWALLET', note: `Ăn uống tháng ${prevMonth} (demo)` });
  // Last month ends at 15,000 - 6,000 - 4,000 = 5,000 TWD.
  await createIncome(token, { amount: 15000, currency: 'TWD', receivedDate: iso(curYear, curMonth, 3), note: `Học bổng tháng ${curMonth} (demo)` });
  await createExpense(token, { amount: 6000, currency: 'TWD', expenseDate: iso(curYear, curMonth, 8), paymentMethod: 'BANK', note: `Tiền nhà tháng ${curMonth} (demo)` });
  // This month ends at 5,000 + 15,000 - 6,000 = 14,000 TWD.

  // ─── USD: isolation check — a currency with all its activity in the past month, zero this
  // month, proving its balance still reports correctly (continuous, not zeroed for inactivity).
  await createIncome(token, { amount: 200, currency: 'USD', receivedDate: iso(prevYear, prevMonth, 12), note: `Freelance thiết kế (demo)` });
  await createExpense(token, { amount: 50, currency: 'USD', expenseDate: iso(prevYear, prevMonth, 18), paymentMethod: 'CARD', note: `Phần mềm thiết kế (demo)` });
  // Ends at 200 - 50 = 150 USD, unchanged this month.

  // ─── A TWD budget for this month — proves budget totals stay scoped to TWD only, unaffected
  // by the much larger VND expenses seeded above. ──────────────────────────────
  try {
    await api('/finance/budgets', {
      method: 'POST',
      token,
      body: { month: curMonth, year: curYear, totalLimit: 20000, currency: 'TWD' },
    });
    console.log('Created a 20,000 TWD budget for this month.');
  } catch (err) {
    console.log(`Skipped budget creation (${(err as Error).message}) — likely already exists for this month.`);
  }

  // ─── A TWD recurring expense — proves recurring-expense listing/forecast still works for
  // this user (left unpaid so it doesn't create an extra Expense row that would change the
  // balance numbers computed above). ──────────────────────────────────────────
  try {
    await api('/finance/recurring-expenses', {
      method: 'POST',
      token,
      body: {
        name: `Bảo hiểm y tế (demo) ${MARKER}`,
        amount: 500,
        currency: 'TWD',
        frequency: 'MONTHLY',
        firstDueDate: iso(curYear, curMonth, 20),
        reminderOffset: 'DAYS_3',
      },
    });
    console.log('Created a monthly 500 TWD recurring expense.');
  } catch (err) {
    console.log(`Skipped recurring-expense creation (${(err as Error).message}).`);
  }

  console.log('Finance demo seed complete.');
  console.log('Expected results:');
  console.log(`  VND current balance: 97,000,000 (last month ended 92,000,000)`);
  console.log(`  TWD current balance: 14,000`);
  console.log(`  USD current balance: 150 (zero activity this month, balance unchanged)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
