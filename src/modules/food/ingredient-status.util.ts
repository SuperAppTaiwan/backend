import { UnitOfMeasure } from '@prisma/client';

export type IngredientStockStatus = 'OUT_OF_STOCK' | 'EXPIRING_SOON' | 'LOW_STOCK' | 'AVAILABLE';

export const EXPIRING_SOON_DAYS = 3;

// Used only when the ingredient has no per-item lowStockThreshold set. Roughly
// "about to run out for typical home-kitchen quantities" per unit family — discrete
// units (pieces/packs/cans) default low at a small integer, weight/volume units
// default low at a small fraction of a common purchase size.
export const DEFAULT_LOW_STOCK_THRESHOLD: Record<UnitOfMeasure, number> = {
  PIECE: 2,
  PACK: 1,
  CAN: 1,
  BOTTLE: 1,
  BOX: 1,
  GRAM: 100,
  KG: 0.2,
  ML: 100,
  LITER: 0.2,
  TABLESPOON: 2,
  TEASPOON: 2,
  CUP: 1,
  OTHER: 1,
};

// Discrete (countable) units are the ones a +/- stepper makes sense for; weight/volume
// units are better served by typing an exact amount.
export const STEPPABLE_UNITS: ReadonlySet<UnitOfMeasure> = new Set([
  UnitOfMeasure.PIECE,
  UnitOfMeasure.PACK,
  UnitOfMeasure.CAN,
  UnitOfMeasure.BOTTLE,
  UnitOfMeasure.BOX,
  UnitOfMeasure.TABLESPOON,
  UnitOfMeasure.TEASPOON,
  UnitOfMeasure.CUP,
]);

// Single source of truth for inventory status: always derived from quantity/unit/
// expiresAt/threshold, never stored — so there is no separate manually-set status
// field that can drift out of sync with the real quantity. Precedence (most urgent
// first): out of stock > expiring soon > low stock > available.
export function computeStockStatus(ingredient: {
  quantity: number;
  unit: UnitOfMeasure;
  expiresAt: Date | null;
  lowStockThreshold: number | null;
}, now: Date = new Date()): IngredientStockStatus {
  if (ingredient.quantity <= 0) return 'OUT_OF_STOCK';

  if (ingredient.expiresAt) {
    const daysLeft = (ingredient.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    if (daysLeft <= EXPIRING_SOON_DAYS) return 'EXPIRING_SOON';
  }

  const threshold = ingredient.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD[ingredient.unit] ?? 1;
  if (ingredient.quantity <= threshold) return 'LOW_STOCK';

  return 'AVAILABLE';
}

export function withStockStatus<
  T extends { quantity: number; unit: UnitOfMeasure; expiresAt: Date | null; lowStockThreshold: number | null },
>(ingredient: T): T & { stockStatus: IngredientStockStatus } {
  return { ...ingredient, stockStatus: computeStockStatus(ingredient) };
}
