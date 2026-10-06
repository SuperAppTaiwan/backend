import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { PayloadTooLargeException } from '@nestjs/common';
import { MAX_STROKES_COMPRESSED_BYTES } from './writing-notebook.constants.js';
import type { Stroke } from './stroke-validation.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Compresses already-serialized stroke JSON for storage in
 * WritingNotebookPage.strokesData. Async zlib so a multi-MB page never blocks
 * the event loop for other requests.
 */
export async function encodeStrokes(json: string): Promise<Buffer> {
  const compressed = await gzipAsync(Buffer.from(json, 'utf8'));
  if (compressed.byteLength > MAX_STROKES_COMPRESSED_BYTES) {
    throw new PayloadTooLargeException('Stroke data for one page is too large');
  }
  return compressed;
}

export async function decodeStrokes(data: Buffer | Uint8Array | null | undefined): Promise<Stroke[]> {
  if (!data || data.byteLength === 0) return [];
  const json = await gunzipAsync(Buffer.from(data));
  return JSON.parse(json.toString('utf8')) as Stroke[];
}
