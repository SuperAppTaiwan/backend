import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {
  COORD_MIN,
  COORD_X_MAX,
  COORD_Y_MAX,
  MAX_POINT_TIME_MS,
  MAX_POINTS_PER_PAGE,
  MAX_POINTS_PER_STROKE,
  MAX_STROKE_WIDTH,
  MAX_STROKES_JSON_BYTES,
  MAX_STROKES_PER_PAGE,
  STROKE_TOOLS,
  StrokeTool,
} from './writing-notebook.constants.js';

/** [x, y, t] or [x, y, t, pressure] — x/y normalized to page width, t in ms from the stroke's first point. */
export type StrokePoint = [number, number, number] | [number, number, number, number];

export interface Stroke {
  id: string;
  tool: StrokeTool;
  color: string;
  width: number;
  /** Epoch ms of the stroke's first point — used to order strokes when merging. */
  startedAt?: number;
  points: StrokePoint[];
}

const STROKE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function fail(message: string): never {
  throw new BadRequestException(message);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validates an untrusted stroke array from a PUT body and returns a canonical
 * copy (unknown keys dropped, coordinates rounded to 5 decimals — ~0.01 px on
 * a 1000 px wide page — times to whole ms, pressure to 3 decimals).
 *
 * Done by hand rather than with class-validator's nested @ValidateNested: a
 * full page can hold hundreds of thousands of points, and instantiating a
 * class per point (what class-transformer would do) is both slow and
 * memory-hungry for no benefit. Throws 400 for malformed data, 413 when the
 * page exceeds the size caps.
 */
export function canonicalizeStrokes(input: unknown): Stroke[] {
  if (!Array.isArray(input)) fail('strokes must be an array');
  if (input.length > MAX_STROKES_PER_PAGE) {
    throw new PayloadTooLargeException(`A page can hold at most ${MAX_STROKES_PER_PAGE} strokes`);
  }

  const seenIds = new Set<string>();
  let totalPoints = 0;
  const out: Stroke[] = [];

  input.forEach((raw, i) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(`strokes[${i}] must be an object`);
    const s = raw as Record<string, unknown>;

    if (typeof s.id !== 'string' || !STROKE_ID_RE.test(s.id)) fail(`strokes[${i}].id is invalid`);
    if (seenIds.has(s.id)) fail(`strokes[${i}].id is duplicated`);
    seenIds.add(s.id);

    if (!STROKE_TOOLS.includes(s.tool as StrokeTool)) fail(`strokes[${i}].tool is invalid`);
    if (typeof s.color !== 'string' || !COLOR_RE.test(s.color)) fail(`strokes[${i}].color is invalid`);
    if (!isFiniteNumber(s.width) || s.width <= 0 || s.width > MAX_STROKE_WIDTH) {
      fail(`strokes[${i}].width is out of range`);
    }
    if (s.startedAt !== undefined && (!isFiniteNumber(s.startedAt) || s.startedAt < 0)) {
      fail(`strokes[${i}].startedAt is invalid`);
    }
    if (!Array.isArray(s.points) || s.points.length === 0) fail(`strokes[${i}].points must be a non-empty array`);
    if (s.points.length > MAX_POINTS_PER_STROKE) {
      throw new PayloadTooLargeException(`A stroke can hold at most ${MAX_POINTS_PER_STROKE} points`);
    }
    totalPoints += s.points.length;
    if (totalPoints > MAX_POINTS_PER_PAGE) {
      throw new PayloadTooLargeException(`A page can hold at most ${MAX_POINTS_PER_PAGE} points`);
    }

    const points: StrokePoint[] = s.points.map((p: unknown, j: number) => {
      if (!Array.isArray(p) || (p.length !== 3 && p.length !== 4) || !p.every(isFiniteNumber)) {
        fail(`strokes[${i}].points[${j}] must be [x, y, t] or [x, y, t, pressure]`);
      }
      const [x, y, t, pressure] = p as number[];
      if (x < COORD_MIN || x > COORD_X_MAX || y < COORD_MIN || y > COORD_Y_MAX) {
        fail(`strokes[${i}].points[${j}] is outside the page`);
      }
      if (t < 0 || t > MAX_POINT_TIME_MS) fail(`strokes[${i}].points[${j}] has an invalid time offset`);
      if (pressure !== undefined && (pressure < 0 || pressure > 1)) {
        fail(`strokes[${i}].points[${j}] pressure must be within [0, 1]`);
      }
      const base: [number, number, number] = [round(x, 5), round(y, 5), Math.round(t)];
      return pressure === undefined ? base : [...base, round(pressure, 3)];
    });

    out.push({
      id: s.id,
      tool: s.tool as StrokeTool,
      color: s.color.toUpperCase(),
      width: round(s.width, 5),
      ...(s.startedAt !== undefined && { startedAt: Math.round(s.startedAt as number) }),
      points,
    });
  });

  return out;
}

/**
 * Validates a PUT /pages/:pageId body: `{ version, strokes }`, nothing else.
 *
 * Deliberately NOT run through the global ValidationPipe/class-transformer:
 * with `transform: true`, plainToInstance deep-copies every nested value, and
 * for stroke data that is hundreds of thousands of tiny arrays. Measured on a
 * 9 MB body: JSON.parse 67 ms / +20 MB heap vs class-transformer + validation
 * 2.6 s / +108 MB — enough to OOM-kill the 512 MB production instance on a
 * large page (it did, during the post-deploy smoke test).
 */
export function parsePageUpdateBody(body: unknown): { version: number; strokes: Stroke[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) fail('Body must be an object');
  const { version, strokes, ...rest } = body as Record<string, unknown>;
  const extra = Object.keys(rest);
  if (extra.length) fail(`property ${extra[0]} should not exist`);
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    fail('version must be a positive integer');
  }
  return { version, strokes: canonicalizeStrokes(strokes) };
}

/** Serializes canonical strokes, enforcing the raw byte cap (413 when exceeded). */
export function serializeStrokes(strokes: Stroke[]): string {
  const json = JSON.stringify(strokes);
  if (Buffer.byteLength(json, 'utf8') > MAX_STROKES_JSON_BYTES) {
    throw new PayloadTooLargeException(
      `Stroke data for one page must be at most ${Math.round(MAX_STROKES_JSON_BYTES / 1024 / 1024)} MB`,
    );
  }
  return json;
}
