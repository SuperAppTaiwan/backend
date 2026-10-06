import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { canonicalizeStrokes, serializeStrokes } from './stroke-validation.js';
import { decodeStrokes, encodeStrokes } from './stroke-codec.js';
import { MAX_STROKES_PER_PAGE } from './writing-notebook.constants.js';

const valid = (overrides: Record<string, unknown> = {}) => ({
  id: 'abc_123',
  tool: 'pen',
  color: '#ff0000',
  width: 0.0061234567,
  startedAt: 1_700_000_000_000.4,
  points: [
    [0.123456789, 0.5, 0.4],
    [0.2, 0.6, 16.6, 0.51234],
  ],
  ...overrides,
});

describe('canonicalizeStrokes', () => {
  it('rounds values, uppercases colours and drops unknown keys', () => {
    const [s] = canonicalizeStrokes([{ ...valid(), extra: 'nope' }]);
    expect(s).toEqual({
      id: 'abc_123',
      tool: 'pen',
      color: '#FF0000',
      width: 0.00612,
      startedAt: 1_700_000_000_000,
      points: [
        [0.12346, 0.5, 0],
        [0.2, 0.6, 17, 0.512],
      ],
    });
    expect(s).not.toHaveProperty('extra');
  });

  it('accepts an empty page', () => {
    expect(canonicalizeStrokes([])).toEqual([]);
  });

  it.each([
    ['not an array', 'x'],
    ['bad id', [valid({ id: 'has space' })]],
    ['duplicate ids', [valid(), valid()]],
    ['unknown tool', [valid({ tool: 'laser' })]],
    ['bad colour', [valid({ color: 'red' })]],
    ['zero width', [valid({ width: 0 })]],
    ['empty points', [valid({ points: [] })]],
    ['point with 2 values', [valid({ points: [[0.1, 0.1]] })]],
    ['NaN coordinate', [valid({ points: [[Number.NaN, 0.1, 0]] })]],
    ['off-page coordinate', [valid({ points: [[3, 0.1, 0]] })]],
    ['negative time', [valid({ points: [[0.1, 0.1, -5]] })]],
    ['pressure > 1', [valid({ points: [[0.1, 0.1, 0, 2]] })]],
  ])('rejects %s with 400', (_label, input) => {
    expect(() => canonicalizeStrokes(input)).toThrow(BadRequestException);
  });

  it('rejects too many strokes with 413', () => {
    const many = Array.from({ length: MAX_STROKES_PER_PAGE + 1 }, (_, i) => valid({ id: `s${i}` }));
    expect(() => canonicalizeStrokes(many)).toThrow(PayloadTooLargeException);
  });
});

describe('stroke codec', () => {
  it('round-trips through gzip and compresses point-heavy data substantially', async () => {
    const strokes = canonicalizeStrokes(
      Array.from({ length: 200 }, (_, i) =>
        valid({
          id: `s${i}`,
          points: Array.from({ length: 80 }, (_, j) => [0.1 + j * 0.001, 0.2 + i * 0.001, j * 16, 0.5]),
        }),
      ),
    );
    const json = serializeStrokes(strokes);
    const blob = await encodeStrokes(json);

    expect(await decodeStrokes(blob)).toEqual(strokes);
    expect(blob.byteLength).toBeLessThan(json.length / 3);
  });

  it('decodes a missing blob as an empty page', async () => {
    expect(await decodeStrokes(null)).toEqual([]);
  });
});
