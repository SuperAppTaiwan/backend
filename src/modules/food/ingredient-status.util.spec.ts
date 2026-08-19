import { UnitOfMeasure } from '@prisma/client';
import { computeStockStatus, withStockStatus } from './ingredient-status.util.js';

const base = {
  quantity: 5,
  unit: UnitOfMeasure.PIECE,
  expiresAt: null as Date | null,
  lowStockThreshold: null as number | null,
};

describe('computeStockStatus', () => {
  it('returns OUT_OF_STOCK when quantity is zero', () => {
    expect(computeStockStatus({ ...base, quantity: 0 })).toBe('OUT_OF_STOCK');
  });

  it('returns OUT_OF_STOCK when quantity is negative', () => {
    expect(computeStockStatus({ ...base, quantity: -1 })).toBe('OUT_OF_STOCK');
  });

  it('returns EXPIRING_SOON when expiry is within the threshold window, even with plenty of quantity', () => {
    const now = new Date('2026-08-19T00:00:00Z');
    const expiresAt = new Date('2026-08-20T00:00:00Z');
    expect(computeStockStatus({ ...base, quantity: 50, expiresAt }, now)).toBe('EXPIRING_SOON');
  });

  it('does not flag EXPIRING_SOON when out of stock takes precedence', () => {
    const now = new Date('2026-08-19T00:00:00Z');
    const expiresAt = new Date('2026-08-20T00:00:00Z');
    expect(computeStockStatus({ ...base, quantity: 0, expiresAt }, now)).toBe('OUT_OF_STOCK');
  });

  it('returns LOW_STOCK when quantity is at or below the default threshold for the unit', () => {
    expect(computeStockStatus({ ...base, quantity: 2, unit: UnitOfMeasure.PIECE })).toBe('LOW_STOCK');
  });

  it('returns LOW_STOCK using a custom per-ingredient threshold instead of the unit default', () => {
    expect(computeStockStatus({ ...base, quantity: 10, lowStockThreshold: 12 })).toBe('LOW_STOCK');
  });

  it('returns AVAILABLE when quantity comfortably exceeds the threshold and nothing is expiring', () => {
    expect(computeStockStatus({ ...base, quantity: 20 })).toBe('AVAILABLE');
  });

  it('returns AVAILABLE when expiry is far in the future', () => {
    const now = new Date('2026-08-19T00:00:00Z');
    const expiresAt = new Date('2026-09-19T00:00:00Z');
    expect(computeStockStatus({ ...base, quantity: 20, expiresAt }, now)).toBe('AVAILABLE');
  });
});

describe('withStockStatus', () => {
  it('attaches the derived status alongside the original fields', () => {
    const result = withStockStatus({ ...base, quantity: 0, name: 'Trứng' });
    expect(result.stockStatus).toBe('OUT_OF_STOCK');
    expect(result.name).toBe('Trứng');
  });
});
