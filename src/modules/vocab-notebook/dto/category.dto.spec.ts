import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateVocabCategoryDto, UpdateVocabCategoryDto } from './category.dto.js';

async function validateCreate(payload: unknown) {
  return validate(plainToInstance(CreateVocabCategoryDto, payload));
}

async function validateUpdate(payload: unknown) {
  return validate(plainToInstance(UpdateVocabCategoryDto, payload));
}

describe('CreateVocabCategoryDto validation', () => {
  it('accepts a normal name', async () => {
    expect(await validateCreate({ name: 'Công việc' })).toHaveLength(0);
  });

  it('rejects a missing name', async () => {
    const errors = await validateCreate({});
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects an empty-string name', async () => {
    const errors = await validateCreate({ name: '' });
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  // The regression this DTO exists to prevent: MinLength(1) alone treats a
  // whitespace-only string as valid (its raw length is >= 1) — reproduced
  // live against the real backend before this fix (HTTP 201, name: "").
  it('rejects a whitespace-only name', async () => {
    const errors = await validateCreate({ name: '   ' });
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects a name that is only a tab/newline', async () => {
    const errors = await validateCreate({ name: '\t\n' });
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('accepts a name with meaningful content plus surrounding whitespace (service trims it later)', async () => {
    expect(await validateCreate({ name: '  HSK 1  ' })).toHaveLength(0);
  });
});

describe('UpdateVocabCategoryDto validation', () => {
  it('accepts an empty body (name is optional on update)', async () => {
    expect(await validateUpdate({})).toHaveLength(0);
  });

  it('rejects a whitespace-only name on update too', async () => {
    const errors = await validateUpdate({ name: '   ' });
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });
});
