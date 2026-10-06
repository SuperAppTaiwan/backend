import { buildPagePreview, decimateUniform, simplifyPolyline } from './stroke-preview.js';
import type { Stroke } from './stroke-validation.js';
import { PREVIEW_MAX_POINTS } from './writing-notebook.constants.js';

const line = (id: string, n: number, y = 0.5, tool: Stroke['tool'] = 'pen'): Stroke => ({
  id,
  tool,
  color: '#112233',
  width: 0.006,
  points: Array.from({ length: n }, (_, i) => [i / Math.max(1, n - 1), y + Math.sin(i) * 0.05, i * 10]),
});

describe('simplifyPolyline', () => {
  it('collapses collinear points to the endpoints', () => {
    const pts: Array<[number, number]> = Array.from({ length: 50 }, (_, i) => [i / 49, 0.5]);
    expect(simplifyPolyline(pts, 0.001)).toEqual([
      [0, 0.5],
      [1, 0.5],
    ]);
  });

  it('keeps corners above the tolerance', () => {
    const pts: Array<[number, number]> = [
      [0, 0],
      [0.5, 0.0001],
      [0.5, 0.5],
      [1, 0.5],
    ];
    expect(simplifyPolyline(pts, 0.01)).toEqual([
      [0, 0],
      [0.5, 0.0001],
      [0.5, 0.5],
      [1, 0.5],
    ]);
  });
});

describe('decimateUniform', () => {
  it('keeps evenly spaced points including both endpoints', () => {
    const pts: Array<[number, number]> = Array.from({ length: 101 }, (_, i) => [i, 0]);
    const out = decimateUniform(pts, 5);
    expect(out.map(([x]) => x)).toEqual([0, 25, 50, 75, 100]);
  });

  it('leaves short polylines untouched', () => {
    const pts: Array<[number, number]> = [
      [0, 0],
      [1, 1],
    ];
    expect(decimateUniform(pts, 1)).toBe(pts);
  });
});

describe('buildPagePreview', () => {
  it('produces integer SVG paths and marks highlighter strokes', () => {
    const preview = buildPagePreview([line('a', 10), line('b', 10, 0.8, 'highlighter')]);
    expect(preview.strokes).toHaveLength(2);
    expect(preview.strokes[0].d).toMatch(/^M\d+ \d+(L-?\d+ -?\d+)+$/);
    expect(preview.strokes[0].w).toBe(6);
    expect(preview.strokes[1].h).toBe(1);
    expect(preview.truncated).toBeUndefined();
  });

  it('merges consecutive same-style strokes into one path but keeps z-order across styles', () => {
    const red = (id: string): Stroke => ({ ...line(id, 3), color: '#FF0000' });
    const preview = buildPagePreview([line('a', 3), line('b', 3), red('c'), line('d', 3)]);
    expect(preview.strokes.map((s) => s.c)).toEqual(['#112233', '#FF0000', '#112233']);
    expect(preview.strokes[0].d.match(/M/g)).toHaveLength(2);
  });

  it('renders a single-point dot as a zero-length segment', () => {
    const dot: Stroke = { id: 'd', tool: 'pen', color: '#000000', width: 0.01, points: [[0.5, 0.5, 0]] };
    expect(buildPagePreview([dot]).strokes[0].d).toBe('M500 500L500 500');
  });

  it('stays within the point budget, quickly, on a stroke-heavy zig-zag page', () => {
    // Every point of a sin(i) zig-zag is a corner — RDP's O(n²) worst case.
    const heavy = Array.from({ length: 1000 }, (_, i) => line(`s${i}`, 400, (i % 40) / 10));
    const started = Date.now();
    const preview = buildPagePreview(heavy);
    expect(Date.now() - started).toBeLessThan(2000);
    const points = preview.strokes.reduce((sum, s) => sum + (s.d.match(/[ML]/g)?.length ?? 0), 0);
    expect(points).toBeLessThanOrEqual(PREVIEW_MAX_POINTS);
    expect(preview.strokes.length).toBeGreaterThan(0);
  });
});
