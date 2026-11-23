import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler.ts';

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const FILE_ID_PATTERN = /^[a-zA-Z0-9_-]{4,80}$/;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
  '.md',
  '.json',
  '.zip',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.ipynb',
  '.py',
  '.ts',
  '.js',
]);

interface StoredFileMeta {
  fileId: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  uploaderUid: string;
  groupId: string;
  uploadedAt: string;
}

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function sanitizeFileName(rawName: string): string {
  const base = path.basename(rawName || 'resource.txt');
  const cleaned = base.replace(/[^a-zA-Z0-9._\- ]/g, '_').trim();
  return cleaned.slice(0, 120) || 'resource.txt';
}

export function formatFileSizeLabel(bytes: number, filename: string): string {
  const ext = path.extname(filename).replace('.', '').toUpperCase().slice(0, 6);
  let sizePart: string;
  if (bytes >= 1024 * 1024) {
    sizePart = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else if (bytes >= 1024) {
    sizePart = `${Math.max(1, Math.round(bytes / 1024))} KB`;
  } else {
    sizePart = `${Math.max(1, bytes)} B`;
  }
  const combined = ext ? `${sizePart} ${ext}` : sizePart;
  return combined.slice(0, 32);
}

export function uploadLocalResource(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new AppError('No file payload received for upload.', 400, 'EMPTY_UPLOAD');
    }
    if (body.length > MAX_UPLOAD_BYTES) {
      throw new AppError('File exceeds the 20 MB upload limit.', 413, 'FILE_TOO_LARGE');
    }

    const rawHeaderName = req.header('x-file-name') || 'academic-resource.txt';
    let decodedName = rawHeaderName;
    try {
      decodedName = decodeURIComponent(rawHeaderName);
    } catch {
      decodedName = rawHeaderName;
    }
    const originalName = sanitizeFileName(decodedName);
    const ext = path.extname(originalName).toLowerCase();

    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
      throw new AppError(
        `File type "${ext || 'unknown'}" is not permitted. Allowed academic formats: PDF, Office docs, CSV, TXT, MD, JSON, ZIP, images, IPYNB, PY, TS, JS.`,
        415,
        'UNSUPPORTED_FILE_TYPE',
      );
    }

    ensureUploadsDir();

    const rawMime = (req.header('x-file-type') || 'application/octet-stream').split(';')[0].trim();
    const contentType = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(rawMime)
      ? rawMime.slice(0, 120)
      : 'application/octet-stream';

    const requestedId = req.header('x-file-id');
    const fileId =
      requestedId && FILE_ID_PATTERN.test(requestedId)
        ? requestedId
        : `res-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;

    const groupId = (req.header('x-group-id') || '').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
    const uploaderUid = req.authUser?.uid || 'unknown';

    const binPath = path.join(UPLOADS_DIR, `${fileId}.bin`);
    const metaPath = path.join(UPLOADS_DIR, `${fileId}.json`);

    const meta: StoredFileMeta = {
      fileId,
      originalName,
      contentType,
      sizeBytes: body.length,
      uploaderUid,
      groupId,
      uploadedAt: new Date().toISOString(),
    };

    fs.writeFileSync(binPath, body);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    res.status(201).json({
      success: true,
      data: {
        fileId,
        url: `/api/resources/files/${fileId}`,
        originalName,
        contentType,
        sizeBytes: body.length,
        fileSizeLabel: formatFileSizeLabel(body.length, originalName),
      },
    });
  } catch (err) {
    next(err);
  }
}

export function downloadLocalResource(req: Request, res: Response, next: NextFunction) {
  try {
    const fileId = req.params.fileId;
    if (!fileId || !FILE_ID_PATTERN.test(fileId)) {
      throw new AppError('Invalid resource file identifier.', 400, 'INVALID_FILE_ID');
    }

    const binPath = path.join(UPLOADS_DIR, `${fileId}.bin`);
    const metaPath = path.join(UPLOADS_DIR, `${fileId}.json`);

    if (!fs.existsSync(binPath) || !fs.existsSync(metaPath)) {
      throw new AppError('Resource file not found on server.', 404, 'FILE_NOT_FOUND');
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as StoredFileMeta;
    const forceDownload = req.query.download === '1';
    const disposition = forceDownload ? 'attachment' : 'inline';
    const safeFilename = meta.originalName.replace(/"/g, '');

    res.setHeader('Content-Type', meta.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeFilename}"`);
    res.setHeader('X-File-Name', encodeURIComponent(meta.originalName));
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (
      meta.contentType.includes('html') ||
      meta.contentType.includes('svg') ||
      meta.contentType.includes('xml')
    ) {
      res.setHeader('Content-Security-Policy', 'sandbox');
    }

    res.sendFile(binPath);
  } catch (err) {
    next(err);
  }
}
