import { normalizeTraditionalFields } from './vocab-word-normalization.js';

describe('normalizeTraditionalFields', () => {
  it('falls back to simplified when traditional is blank', () => {
    const result = normalizeTraditionalFields({
      simplified: '电影', simplifiedPinyin: 'diànyǐng', traditional: undefined, traditionalPinyin: undefined,
    });
    expect(result).toEqual({ traditional: '电影', traditionalPinyin: 'diànyǐng' });
  });

  it('falls back when traditional is an empty/whitespace string, not just undefined', () => {
    const result = normalizeTraditionalFields({
      simplified: '东西', simplifiedPinyin: 'dōngxī', traditional: '   ', traditionalPinyin: '',
    });
    expect(result).toEqual({ traditional: '东西', traditionalPinyin: 'dōngxī' });
  });

  it('preserves an explicitly different traditional form — never overwritten by simplified', () => {
    const result = normalizeTraditionalFields({
      simplified: '爱', simplifiedPinyin: 'ài', traditional: '愛', traditionalPinyin: 'ài',
    });
    expect(result).toEqual({ traditional: '愛', traditionalPinyin: 'ài' });
  });

  it('normalizes traditional and traditionalPinyin independently', () => {
    const result = normalizeTraditionalFields({
      simplified: '车', simplifiedPinyin: 'chē', traditional: '車', traditionalPinyin: undefined,
    });
    expect(result).toEqual({ traditional: '車', traditionalPinyin: 'chē' });
  });

  it('trims whitespace around a supplied traditional value', () => {
    const result = normalizeTraditionalFields({
      simplified: '车', simplifiedPinyin: 'chē', traditional: '  車  ', traditionalPinyin: ' chē ',
    });
    expect(result).toEqual({ traditional: '車', traditionalPinyin: 'chē' });
  });
});
