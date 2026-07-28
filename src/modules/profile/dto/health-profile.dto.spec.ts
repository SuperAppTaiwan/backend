import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateHealthProfileDto } from './health-profile.dto.js';

async function validateDto(payload: unknown) {
  const dto = plainToInstance(UpdateHealthProfileDto, payload);
  return validate(dto);
}

describe('UpdateHealthProfileDto validation', () => {
  it('accepts a fully valid payload with no errors', async () => {
    const errors = await validateDto({
      weightKg: 65,
      heightCm: 172,
      allergies: [{ name: 'Đậu phộng', severity: 'severe' }],
      healthConditions: [{ name: 'Tiểu đường', status: 'active' }],
      medications: [{ name: 'Metformin', dosage: '500mg' }],
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts an empty payload (all fields optional)', async () => {
    const errors = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('accepts explicit null on weightKg/heightCm/arrays (used to clear a field)', async () => {
    const errors = await validateDto({ weightKg: null, heightCm: null, allergies: null });
    expect(errors).toHaveLength(0);
  });

  it('rejects weightKg <= 0', async () => {
    const errors = await validateDto({ weightKg: 0 });
    expect(errors.some((e) => e.property === 'weightKg')).toBe(true);
  });

  it('rejects a negative weightKg', async () => {
    const errors = await validateDto({ weightKg: -10 });
    expect(errors.some((e) => e.property === 'weightKg')).toBe(true);
  });

  it('rejects an unreasonably large weightKg', async () => {
    const errors = await validateDto({ weightKg: 5000 });
    expect(errors.some((e) => e.property === 'weightKg')).toBe(true);
  });

  it('rejects heightCm <= 0', async () => {
    const errors = await validateDto({ heightCm: 0 });
    expect(errors.some((e) => e.property === 'heightCm')).toBe(true);
  });

  it('rejects an unreasonably large heightCm', async () => {
    const errors = await validateDto({ heightCm: 1000 });
    expect(errors.some((e) => e.property === 'heightCm')).toBe(true);
  });

  it('rejects an allergy entry missing the required name field', async () => {
    const errors = await validateDto({ allergies: [{ severity: 'mild' }] });
    expect(errors.some((e) => e.property === 'allergies')).toBe(true);
  });

  it('rejects an allergy entry with an invalid severity enum value', async () => {
    const errors = await validateDto({ allergies: [{ name: 'Tôm', severity: 'catastrophic' }] });
    expect(errors.some((e) => e.property === 'allergies')).toBe(true);
  });

  it('rejects a malformed nested medications array (non-object entries)', async () => {
    const errors = await validateDto({ medications: ['just a string, not an object'] });
    expect(errors.some((e) => e.property === 'medications')).toBe(true);
  });

  it('rejects a healthConditions entry with an invalid status enum value', async () => {
    const errors = await validateDto({ healthConditions: [{ name: 'Gout', status: 'nonsense' }] });
    expect(errors.some((e) => e.property === 'healthConditions')).toBe(true);
  });
});
