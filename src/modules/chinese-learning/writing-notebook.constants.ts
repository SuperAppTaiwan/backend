// Limits for the handwriting practice notebook (Vở luyện viết).
//
// Page COUNT is deliberately unlimited — these only bound a single page's
// payload so one PUT can never produce a document anywhere near MongoDB's
// 16 MB limit. Strokes are stored gzip-compressed (see stroke-codec.ts); the
// raw cap below is measured on the canonical (rounded) JSON BEFORE
// compression, so the stored blob is always a small fraction of it.

/**
 * Max raw PUT body for a page, checked from Content-Length BEFORE the body is
 * parsed (see page-request-size.middleware.ts). A little above the canonical
 * cap below, since the client may send unrounded numbers.
 */
export const MAX_PAGE_REQUEST_BYTES = 10 * 1024 * 1024;
/** Max canonical stroke JSON per page, in bytes (~8 MB). */
export const MAX_STROKES_JSON_BYTES = 8 * 1024 * 1024;
/** Hard ceiling on the compressed blob actually written to MongoDB. */
export const MAX_STROKES_COMPRESSED_BYTES = 12 * 1024 * 1024;
export const MAX_STROKES_PER_PAGE = 10_000;
export const MAX_POINTS_PER_STROKE = 5_000;
export const MAX_POINTS_PER_PAGE = 400_000;

/**
 * Coordinates are normalized to the page WIDTH on both axes (isotropic), so x
 * is in [0, 1] and y is in [0, pageHeight / pageWidth]. A little overshoot is
 * tolerated because a finger can legitimately slide past the page edge.
 */
export const COORD_MIN = -0.1;
export const COORD_X_MAX = 1.1;
export const COORD_Y_MAX = 50;
/** Stroke width, as a fraction of page width. */
export const MAX_STROKE_WIDTH = 0.2;
/** Per-point time offset from the stroke's first point, in ms (1 hour). */
export const MAX_POINT_TIME_MS = 3_600_000;

export const STROKE_TOOLS = ['pen', 'highlighter'] as const;
export type StrokeTool = (typeof STROKE_TOOLS)[number];

export const GRID_LIMITS = {
  columns: { min: 2, max: 20 },
  rows: { min: 1, max: 40 },
  marginRatio: { min: 0, max: 2 },
  pinyinBandRatio: { min: 0.2, max: 1.5 },
  rowGapRatio: { min: 0, max: 2 },
} as const;

export const MAX_GUIDES_PER_PAGE = 40;

export const PAGE_LIST_DEFAULT_LIMIT = 20;
export const PAGE_LIST_MAX_LIMIT = 50;

/** Thumbnail preview budget — see stroke-preview.ts. */
export const PREVIEW_MAX_POINTS = 2_000;
/** Preview coordinates are integers in units of 1/1000 page width. */
export const PREVIEW_SCALE = 1000;
