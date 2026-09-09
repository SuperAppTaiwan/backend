/**
 * One-time (but idempotent/safe-to-re-run) backfill for the new Goal.currency field.
 *
 * WHY THIS IS NEEDED: MongoDB does not enforce a schema server-side, and Prisma's `@default`
 * only applies when a document is CREATED through Prisma — it never retroactively rewrites
 * existing documents. Any Goal created before `currency` was added to the schema has no
 * `currency` key in its underlying Mongo document at all. Once the Prisma Client is regenerated
 * from the updated schema, `prisma.goal.findMany()`/`findFirst()` on those older documents would
 * fail (a required, non-optional field is missing), so this backfill MUST run before the app
 * serves traffic against the updated schema.
 *
 * ASSUMPTION (reported explicitly, not silently guessed): every pre-existing Goal is treated as
 * TWD. This mirrors every other monetary model in this schema — Income, Expense, Budget, and
 * IncomeSource all default to "TWD" — so a goal created before currency-awareness existed is
 * assumed to have been created under the same implicit single-currency assumption the rest of
 * the app made at the time. This is a metadata backfill only: it adds a `currency` field, it
 * never touches targetAmount/currentAmount or any other value.
 *
 * SAFETY:
 *  - Uses a raw MongoDB `update` command scoped to `{ currency: { $exists: false } }`, so it
 *    only ever touches documents that are actually missing the field — never overwrites a
 *    currency a later run (or a real create/update) has already set.
 *  - Idempotent: a second run matches zero documents and is a no-op.
 *  - Non-destructive: only adds a field via $set, never deletes or resets anything.
 *  - Scoped to the `goals` collection only.
 *
 * Usage: pnpm backfill:goal-currency
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RawUpdateResult {
  n?: number;
  nModified?: number;
  ok?: number;
}

async function main() {
  console.log('Backfilling Goal.currency for documents missing the field (assumption: TWD)...');

  const result = (await prisma.$runCommandRaw({
    update: 'goals',
    updates: [
      {
        q: { currency: { $exists: false } },
        u: { $set: { currency: 'TWD' } },
        multi: true,
      },
    ],
  })) as RawUpdateResult;

  console.log(`Matched/modified: ${result.n ?? 0} goal document(s).`);
  console.log('Backfill complete. Re-running this script again is safe and will report 0.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
