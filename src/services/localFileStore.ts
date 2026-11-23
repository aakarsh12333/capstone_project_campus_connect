import { SCHEMA_LIMITS } from '../types/campus';
import { getAuthHeaders } from './authToken';

const IDB_NAME = 'campus-connect-local-files';
const IDB_STORE = 'files';
export const MAX_LOCAL_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

export const ALLOWED_UPLOAD_EXTENSIONS = [
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
] as const;

export const ACCEPT_UPLOAD_EXTENSIONS = ALLOWED_UPLOAD_EXTENSIONS.join(',');

export interface CachedLocalFile {
  fileId: string;
  url: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  groupId?: string;
  blob: Blob;
  pendingSync: boolean;
  createdAt: number;
}

export function isLocalResourceUrl(url: string): boolean {
  return typeof url === 'string' && url.startsWith('/api/resources/files/');
}

export function extractFileIdFromUrl(url: string): string {
  return url.replace('/api/resources/files/', '').split('?')[0].trim();
}

export function validateLocalUploadFile(file: File): string | null {
  if (file.size === 0) {
    return 'The selected file is empty.';
  }
  if (file.size > MAX_LOCAL_UPLOAD_BYTES) {
    return 'File exceeds the 20 MB maximum upload limit.';
  }
  const dotIdx = file.name.lastIndexOf('.');
  const ext = dotIdx >= 0 ? file.name.slice(dotIdx).toLowerCase() : '';
  if (!ext || !(ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    return `File type "${ext || 'unknown'}" is not allowed. Supported formats: PDF, Office docs, CSV, TXT, MD, JSON, ZIP, images, IPYNB, PY, TS, JS.`;
  }
  return null;
}

export function formatClientFileSizeLabel(bytes: number, filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  const ext = dotIdx >= 0 ? filename.slice(dotIdx + 1).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '';
  let sizePart: string;
  if (bytes >= 1024 * 1024) {
    sizePart = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else if (bytes >= 1024) {
    sizePart = `${Math.max(1, Math.round(bytes / 1024))} KB`;
  } else {
    sizePart = `${Math.max(1, bytes)} B`;
  }
  const combined = ext ? `${sizePart} ${ext}` : sizePart;
  return combined.slice(0, SCHEMA_LIMITS.fileSizeLabelMax);
}

function openFileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'fileId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open local file cache'));
  });
}

async function putCachedFile(record: CachedLocalFile): Promise<void> {
  try {
    const db = await openFileDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Non-fatal if browser storage is restricted
  }
}

export async function getCachedFileById(fileId: string): Promise<CachedLocalFile | null> {
  try {
    const db = await openFileDb();
    const result = await new Promise<CachedLocalFile | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(fileId);
      req.onsuccess = () => resolve((req.result as CachedLocalFile | undefined) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

async function listPendingSyncFiles(): Promise<CachedLocalFile[]> {
  try {
    const db = await openFileDb();
    const all = await new Promise<CachedLocalFile[]>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve((req.result as CachedLocalFile[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all.filter((f) => f.pendingSync);
  } catch {
    return [];
  }
}

async function postFileToServer(params: {
  fileId: string;
  filename: string;
  contentType: string;
  groupId?: string;
  blob: Blob;
}): Promise<{ url: string; fileSizeLabel: string }> {
  const headers = await getAuthHeaders({
    'Content-Type': 'application/octet-stream',
    'X-File-Id': params.fileId,
    'X-File-Name': encodeURIComponent(params.filename),
    'X-File-Type': params.contentType || 'application/octet-stream',
    ...(params.groupId ? { 'X-Group-Id': params.groupId } : {}),
  });

  const res = await fetch('/api/resources/upload', {
    method: 'POST',
    headers,
    body: params.blob,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    const msg = errBody?.error?.message || `Upload failed with status ${res.status}`;
    throw new Error(msg);
  }

  const json = await res.json();
  return {
    url: json.data.url as string,
    fileSizeLabel: json.data.fileSizeLabel as string,
  };
}

export async function uploadLocalResourceFile(
  file: File,
  groupId?: string,
): Promise<{
  url: string;
  fileSizeLabel: string;
  queuedOffline: boolean;
}> {
  const validationErr = validateLocalUploadFile(file);
  if (validationErr) {
    throw new Error(validationErr);
  }

  const rand = Math.random().toString(36).slice(2, 8);
  const fileId = `res-${Date.now().toString(36)}-${rand}`;
  const url = `/api/resources/files/${fileId}`;
  const fileSizeLabel = formatClientFileSizeLabel(file.size, file.name);
  const contentType = file.type || 'application/octet-stream';

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (isOffline) {
    await putCachedFile({
      fileId,
      url,
      filename: file.name,
      contentType,
      sizeBytes: file.size,
      groupId,
      blob: file,
      pendingSync: true,
      createdAt: Date.now(),
    });
    return { url, fileSizeLabel, queuedOffline: true };
  }

  try {
    const uploaded = await postFileToServer({
      fileId,
      filename: file.name,
      contentType,
      groupId,
      blob: file,
    });
    await putCachedFile({
      fileId,
      url: uploaded.url,
      filename: file.name,
      contentType,
      sizeBytes: file.size,
      groupId,
      blob: file,
      pendingSync: false,
      createdAt: Date.now(),
    });
    return {
      url: uploaded.url,
      fileSizeLabel: uploaded.fileSizeLabel || fileSizeLabel,
      queuedOffline: false,
    };
  } catch (err) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await putCachedFile({
        fileId,
        url,
        filename: file.name,
        contentType,
        sizeBytes: file.size,
        groupId,
        blob: file,
        pendingSync: true,
        createdAt: Date.now(),
      });
      return { url, fileSizeLabel, queuedOffline: true };
    }
    throw err;
  }
}

export async function syncPendingLocalUploads(): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  const pending = await listPendingSyncFiles();
  let synced = 0;

  for (const item of pending) {
    try {
      await postFileToServer({
        fileId: item.fileId,
        filename: item.filename,
        contentType: item.contentType,
        groupId: item.groupId,
        blob: item.blob,
      });
      await putCachedFile({ ...item, pendingSync: false });
      synced += 1;
    } catch {
      // Leave pending for next online retry
    }
  }

  return synced;
}

function triggerAnchorNavigation(href: string, downloadFilename?: string) {
  const anchor = document.createElement('a');
  anchor.href = href;
  if (downloadFilename !== undefined) {
    anchor.download = downloadFilename;
  } else {
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  }
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export async function openOrDownloadResource(resource: {
  url: string;
  title: string;
}): Promise<void> {
  if (isLocalResourceUrl(resource.url)) {
    const fileId = extractFileIdFromUrl(resource.url);
    const cached = await getCachedFileById(fileId);
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    if (cached && (isOffline || cached.pendingSync)) {
      const objectUrl = URL.createObjectURL(cached.blob);
      triggerAnchorNavigation(objectUrl, cached.filename || resource.title);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2500);
      return;
    }

    if (isOffline && !cached) {
      throw new Error('This file has not been cached offline yet. Connect to download it.');
    }

    const headers = await getAuthHeaders();
    const res = await fetch(`${resource.url}?download=1`, { headers });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new Error(errBody?.error?.message || `Unable to download file (${res.status}).`);
    }

    const blob = await res.blob();
    const headerName = res.headers.get('X-File-Name');
    let filename = cached?.filename || resource.title || 'resource';
    if (headerName) {
      try {
        filename = decodeURIComponent(headerName);
      } catch {
        filename = headerName;
      }
    }

    const objectUrl = URL.createObjectURL(blob);
    triggerAnchorNavigation(objectUrl, filename);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2500);
    return;
  }

  triggerAnchorNavigation(resource.url);
}
