import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { MimeTypeSchema } from '../schemas/common.js';

/**
 * Shared input shape and body for the two `lexware_upload_*` tools.
 *
 * Both tools accept the file either inline (`contentBase64`) or as a path on
 * the MCP server host (`filePath`). The path form exists because base64 inflates
 * the payload by ~33% and has to travel through the model's context window —
 * a 4 MB scan is unusable inline but trivial by path.
 *
 * Kept in one module (like `_download.ts`) so the two tools cannot drift apart
 * in how they resolve a source, derive a name, or sniff a content type.
 */

// contentType auto-detection for the image formats Lexware accepts alongside
// PDF. Anything not listed falls back to application/pdf, matching the previous
// contentBase64-only default.
const EXT_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
};

export interface UploadSource {
  filePath?: string;
  contentBase64?: string;
  fileName?: string;
  contentType?: string;
}

export interface ResolvedUpload {
  buffer: Buffer;
  fileName: string;
  contentType: string;
}

const UploadSourceParams = {
  filePath: z
    .string()
    .optional()
    .describe('Absolute path to the file on the MCP server host. Must be readable by the MCP server process.'),
  contentBase64: z
    .string()
    .optional()
    .describe('Base64-encoded file content. Required when filePath is not provided.'),
  fileName: z
    .string()
    .optional()
    .describe('File name for the upload. Required when using contentBase64; derived from filePath when omitted.'),
  // MimeTypeSchema (#88) is the boundary guard shared with assertValidMimeType at
  // the sink; the filePath path feeds this same field from EXT_CONTENT_TYPES, whose
  // values are all plain type/subtype and so satisfy the same grammar.
  contentType: MimeTypeSchema.optional(),
};

/**
 * Build an upload tool's input schema: the caller's own params (e.g. the voucher
 * `id`) first, so they keep their leading position in the emitted `required[]`,
 * then the shared source params, then the two cross-field rules.
 *
 * Zod 4 folds `.refine()` into the schema itself rather than wrapping it in a
 * ZodEffects, so the returned object still exposes `.shape` and still converts
 * to a flat JSON Schema for `tools/list`.
 */
export function uploadInputSchema<Shape extends z.ZodRawShape>(extra: Shape) {
  return z
    .object({ ...extra, ...UploadSourceParams })
    // The generic `Shape` leaves zod's inferred output type unresolved here, so the
    // shared source fields are read back through UploadSource — the very keys this
    // function just spread in, hence a widening cast rather than an assumption.
    .refine((data) => {
      const { filePath, contentBase64 } = data as UploadSource;
      return !!filePath !== !!contentBase64;
    }, {
      message: 'Exactly one of filePath or contentBase64 must be provided',
    })
    .refine((data) => {
      const { contentBase64, fileName } = data as UploadSource;
      return !(contentBase64 && !fileName);
    }, {
      message: 'fileName is required when using contentBase64',
    });
}

/**
 * Turn a validated upload input into the (buffer, fileName, contentType) triple
 * `lexwareUpload` takes.
 *
 * The filePath branch resolves symlinks and probes readability BEFORE reading, so
 * a bad path fails with a message naming the path and the OS error instead of a
 * bare ENOENT from deep inside the read. Both failures chain the original error as
 * `cause` — the errno, syscall and path stay recoverable for a caller that inspects
 * it, while the message stays readable.
 */
export function resolveUpload(params: UploadSource): ResolvedUpload {
  if (params.filePath === undefined) {
    // The schema's refinements guarantee contentBase64 and fileName are present
    // on this branch; assert rather than re-validate so the two cannot disagree.
    const { contentBase64, fileName } = params;
    if (contentBase64 === undefined || fileName === undefined) {
      throw new Error('contentBase64 and fileName are required when filePath is not provided');
    }
    return {
      buffer: Buffer.from(contentBase64, 'base64'),
      fileName,
      contentType: params.contentType ?? 'application/pdf',
    };
  }

  const { filePath } = params;
  if (!path.isAbsolute(filePath)) {
    throw new Error(`filePath must be absolute, got: ${filePath}`);
  }

  let resolved: string;
  try {
    resolved = fs.realpathSync(filePath);
  } catch (err) {
    throw new Error(
      `Cannot resolve filePath "${filePath}": ${(err as NodeJS.ErrnoException).message}`,
      { cause: err },
    );
  }

  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch (err) {
    throw new Error(
      `File not readable at "${resolved}": ${(err as NodeJS.ErrnoException).message}`,
      { cause: err },
    );
  }

  const ext = path.extname(resolved).toLowerCase();
  return {
    buffer: fs.readFileSync(resolved),
    fileName: params.fileName ?? path.basename(resolved),
    contentType: params.contentType ?? EXT_CONTENT_TYPES[ext] ?? 'application/pdf',
  };
}
