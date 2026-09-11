/**
 * Goals-specific demo seed — additive and idempotent, safe to re-run.
 *
 * Seeds three savings goals in three different currencies for ONE target user, so the
 * currency-isolated goal-projection logic (goals.service.ts's generateForecast/getRecommendations,
 * scoped to financeService.getAverageMonthlyIncome/Expense(userId, goal.currency)) has real
 * multi-currency data to exercise end-to-end:
 *
 *   Goal A — "Quỹ khẩn cấp" (Emergency Fund), target 100,000,000 VND
 *   Goal B — "MacBook mới",   target 60,000 TWD
 *   Goal C — "Laptop dự phòng (USD)", target 800 USD
 *
 * DATA SAFETY: same model as scripts/seed-finance-demo.ts — talks to the real HTTP API (never
 * touches Prisma directly), only ever touches the ONE user identified by SEED_FINANCE_EMAIL,
 * and is idempotent via a `metadataJson.seedMarker` tag checked before creating anything.
 * Also carries the same REAL-ACCOUNT GUARD as seed-finance-demo.ts (see that file's header for
 * the incident this responds to): refuses to create any goal if the account already has goals
 * this script didn't create, unless run with --i-understand-this-is-a-real-account.
 *
 * Usage:
 *   SEED_FINANCE_EMAIL=user@example.com SEED_FINANCE_PASSWORD='...' \
 *     pnpm seed:goals-demo
 */

const API_URL = process.env.SEED_API_URL ?? `http://localhost:${process.env.API_PORT ?? 3000}/api/v1`;
const EMAIL = process.env.SEED_FINANCE_EMAIL;
const PASSWORD = process.env.SEED_FINANCE_PASSWORD;
const MARKER = 'seed-goals-demo';
const ACKNOWLEDGE_REAL_ACCOUNT = process.argv.includes('--i-understand-this-is-a-real-account');

if (!EMAIL || !PASSWORD) {
  console.error('Set SEED_FINANCE_EMAIL and SEED_FINANCE_PASSWORD environment variables before running this script.');
  process.exit(1);
}

interface ApiError {
  message?: string | string[];
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
  tokens: { accessToken: string };
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
    return tokens.accessToken;
  }
}

interface Goal {
  id: string;
  metadataJson: { seedMarker?: string } | null;
}

async function main() {
  const token = await loginOrRegister();

  const existing = await api<Goal[]>('/goals', { token });
  const nonSeedGoals = existing.filter((g) => g.metadataJson?.seedMarker !== MARKER);
  if (nonSeedGoals.length > 0 && !ACKNOWLEDGE_REAL_ACCOUNT) {
    console.error(
      `REFUSING TO SEED: ${EMAIL} already has ${nonSeedGoals.length} goal(s) this script did not create. ` +
        'This looks like a real account, not a throwaway demo account. Re-run with ' +
        '--i-understand-this-is-a-real-account if you are certain, otherwise use a dedicated empty demo account.',
    );
    process.exit(1);
  }

  if (existing.some((g) => g.metadataJson?.seedMarker === MARKER)) {
    console.log('Goals demo data already present for this user — skipping.');
    return;
  }

  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  const targetDate = oneYearFromNow.toISOString().split('T')[0];

  const goals = [
    { title: 'Quỹ khẩn cấp', goalType: 'EMERGENCY_FUND', targetAmount: 100000000, currency: 'VND' },
    { title: 'MacBook mới', goalType: 'CUSTOM', targetAmount: 60000, currency: 'TWD' },
    { title: 'Laptop dự phòng (USD)', goalType: 'CUSTOM', targetAmount: 800, currency: 'USD' },
  ] as const;

  for (const g of goals) {
    const created = await api<{ id: string; title: string; currency: string }>('/goals', {
      method: 'POST',
      token,
      body: {
        title: g.title,
        goalType: g.goalType,
        targetAmount: g.targetAmount,
        currency: g.currency,
        targetDate,
        priority: 'MEDIUM',
        metadataJson: { seedMarker: MARKER },
      },
    });
    console.log(`Created goal "${created.title}" (${created.currency}, id=${created.id})`);
  }

  console.log('Goals demo seed complete.');
  console.log('Each goal\'s forecast/recommendations will only ever use its own currency\'s income/expense data.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
