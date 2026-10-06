import { PREVIEW_MAX_POINTS, PREVIEW_SCALE } from './writing-notebook.constants.js';
import type { Stroke } from './stroke-validation.js';

export interface PreviewStroke {
  /** Colour, as stored on the stroke. */
  c: string;
  /** Width in preview units (1/1000 page width). */
  w: number;
  /** 1 when drawn with the highlighter (rendered translucent). */
  h?: 1;
  /** SVG path data in integer preview units. */
  d: string;
}

export interface PagePreview {
  v: 1;
  strokes: PreviewStroke[];
  /** True when the page had more ink than the preview budget could hold. */
  truncated?: boolean;
}

type XY = [number, number];

function perpendicularDistance(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Ramer–Douglas–Peucker polyline simplification. Iterative (explicit stack)
 * rather than recursive so a 5000-point stroke can't blow the call stack.
 */
export function simplifyPolyline(points: XY[], epsilon: number): XY[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > epsilon) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

const EPSILONS = [0.0015, 0.003, 0.006, 0.012, 0.025];
/**
 * RDP is O(n²) per stroke in the worst case (e.g. a dense zig-zag where every
 * point is a corner), so running it over a full 400k-point page took 5-20 s in
 * benchmarks. Uniformly decimating to this many points first (O(n)) bounds the
 * work regardless of input shape; at thumbnail size the lost detail is
 * invisible.
 */
const PRE_DECIMATE_BUDGET = PREVIEW_MAX_POINTS * 4;

/** Keeps ~`keep` evenly spaced points, always including both endpoints. */
export function decimateUniform(points: XY[], keep: number): XY[] {
  if (points.length <= keep || points.length <= 2) return points;
  const k = Math.max(2, keep);
  const out: XY[] = [];
  for (let i = 0; i < k; i++) out.push(points[Math.round((i * (points.length - 1)) / (k - 1))]);
  return out;
}

function toPath(points: XY[]): string {
  // A single-point stroke (a dot) needs a zero-length segment, otherwise
  // "M x y" alone draws nothing even with round line caps.
  const pts = points.length === 1 ? [points[0], points[0]] : points;
  return pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${Math.round(x * PREVIEW_SCALE)} ${Math.round(y * PREVIEW_SCALE)}`)
    .join('');
}

/**
 * Builds the small thumbnail representation stored alongside a page, so the
 * page LIST endpoint can render thumbnails without ever shipping full stroke
 * data. Simplification gets progressively coarser until the whole page fits
 * PREVIEW_MAX_POINTS; if even the coarsest pass doesn't fit, the remaining
 * (newest) strokes are dropped and `truncated` is set.
 */
export function buildPagePreview(strokes: Stroke[]): PagePreview {
  const totalPoints = strokes.reduce((sum, s) => sum + s.points.length, 0);
  const ratio = totalPoints > PRE_DECIMATE_BUDGET ? PRE_DECIMATE_BUDGET / totalPoints : 1;
  const polylines = strokes.map((s) => {
    const pts = s.points.map((p) => [p[0], p[1]] as XY);
    return ratio < 1 ? decimateUniform(pts, Math.ceil(pts.length * ratio)) : pts;
  });

  let simplified: XY[][] = [];
  for (const eps of EPSILONS) {
    simplified = polylines.map((pts) => simplifyPolyline(pts, eps));
    const total = simplified.reduce((sum, pts) => sum + pts.length, 0);
    if (total <= PREVIEW_MAX_POINTS) break;
  }

  const out: PreviewStroke[] = [];
  let budget = PREVIEW_MAX_POINTS;
  let truncated = false;
  for (let i = 0; i < strokes.length; i++) {
    const pts = simplified[i];
    if (pts.length > budget) {
      truncated = true;
      break;
    }
    budget -= pts.length;
    out.push({
      c: strokes[i].color,
      w: Math.max(1, Math.round(strokes[i].width * PREVIEW_SCALE)),
      ...(strokes[i].tool === 'highlighter' && { h: 1 as const }),
      d: toPath(pts),
    });
  }

  return { v: 1, strokes: out, ...(truncated && { truncated: true }) };
}
