import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ScanIngredientDto } from './food.dto.js';

async function validateDto(payload: unknown) {
  const dto = plainToInstance(ScanIngredientDto, payload);
  return validate(dto);
}

describe('ScanIngredientDto validation', () => {
  it('accepts a valid base64 payload with no mimeType', async () => {
    const errors = await validateDto({ imageBase64: 'aGVsbG8=' });
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid base64 payload with mimeType', async () => {
    const errors = await validateDto({ imageBase64: 'aGVsbG8=', mimeType: 'image/jpeg' });
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing imageBase64 (no file/image reached the request at all)', async () => {
    const errors = await validateDto({});
    expect(errors.some((e) => e.property === 'imageBase64')).toBe(true);
  });

  it('rejects an empty-string imageBase64', async () => {
    const errors = await validateDto({ imageBase64: '' });
    expect(errors.some((e) => e.property === 'imageBase64')).toBe(true);
  });

  it('rejects a non-string imageBase64', async () => {
    const errors = await validateDto({ imageBase64: 12345 });
    expect(errors.some((e) => e.property === 'imageBase64')).toBe(true);
  });
});
