import type { NextFunction, Request, Response } from 'express';
import { MAX_PAGE_REQUEST_BYTES } from './writing-notebook.constants.js';

const PAGE_PUT_PATH = /\/chinese-learning\/writing-notebooks\/[^/]+\/pages\/[^/]+\/?$/;

/**
 * Rejects an oversized stroke upload from its Content-Length header, before
 * the JSON body parser buffers and parses it (the app-wide parser allows
 * 15 MB for photo uploads). Must be registered BEFORE the body parser in
 * main.ts. Bodies without Content-Length still hit the parser's own limit and
 * the canonical size cap in stroke-validation.ts.
 */
export function pageRequestSizeGuard(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'PUT' && PAGE_PUT_PATH.test(req.path)) {
    const length = Number(req.headers['content-length']);
    if (Number.isFinite(length) && length > MAX_PAGE_REQUEST_BYTES) {
      res.status(413).json({
        statusCode: 413,
        message: `Stroke data for one page must be at most ${MAX_PAGE_REQUEST_BYTES / 1024 / 1024} MB`,
        path: req.originalUrl,
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }
  next();
}
