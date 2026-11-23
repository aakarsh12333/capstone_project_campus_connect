import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { Socket } from 'socket.io';
import { AppError } from './errorHandler.ts';

export interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: VerifiedFirebaseUser;
    }
  }
}

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedProjectId: string | null = null;
let cachedCerts: Record<string, string> = {};
let certsExpiresAt = 0;

function getFirebaseProjectId(): string {
  if (cachedProjectId) return cachedProjectId;
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as { projectId?: string };
  if (!parsed.projectId) {
    throw new Error('Missing projectId in firebase-applet-config.json');
  }
  cachedProjectId = parsed.projectId;
  return cachedProjectId;
}

async function fetchGooglePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && now < certsExpiresAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new AppError('Unable to fetch Firebase token signing keys.', 503, 'AUTH_KEYS_UNAVAILABLE');
  }

  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;

  cachedCerts = certs;
  certsExpiresAt = now + Math.max(60, maxAgeSec) * 1000;
  return cachedCerts;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const decoded = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(decoded) as T;
}

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseUser> {
  if (!token || typeof token !== 'string') {
    throw new AppError('Missing authentication token.', 401, 'UNAUTHORIZED');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new AppError('Malformed authentication token.', 401, 'INVALID_TOKEN');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; kid?: string };
  let payload: {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  try {
    header = decodeBase64UrlJson(headerB64);
    payload = decodeBase64UrlJson(payloadB64);
  } catch {
    throw new AppError('Unreadable authentication token.', 401, 'INVALID_TOKEN');
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new AppError('Unsupported token algorithm.', 401, 'INVALID_TOKEN');
  }

  const projectId = getFirebaseProjectId();
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  const nowSec = Math.floor(Date.now() / 1000);

  if (payload.aud !== projectId || payload.iss !== expectedIssuer) {
    throw new AppError('Token audience or issuer mismatch.', 401, 'INVALID_TOKEN');
  }
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) {
    throw new AppError('Token subject missing.', 401, 'INVALID_TOKEN');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec - 30) {
    throw new AppError('Authentication token expired.', 401, 'TOKEN_EXPIRED');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new AppError('Token issued-at timestamp invalid.', 401, 'INVALID_TOKEN');
  }

  let certs = await fetchGooglePublicCerts(false);
  let cert = certs[header.kid];
  if (!cert) {
    certs = await fetchGooglePublicCerts(true);
    cert = certs[header.kid];
  }
  if (!cert) {
    throw new AppError('Token signing certificate not recognized.', 401, 'INVALID_TOKEN');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const sigNormalized = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
  const sigBuf = Buffer.from(sigNormalized, 'base64');
  const isValid = verifier.verify(cert, sigBuf);

  if (!isValid) {
    throw new AppError('Invalid token cryptographic signature.', 401, 'INVALID_SIGNATURE');
  }

  return {
    uid: payload.sub,
    email: payload.email,
    emailVerified: Boolean(payload.email_verified),
    name: payload.name,
  };
}

export async function requireFirebaseAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.header('authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    const token = bearerToken || queryToken;

    if (!token) {
      throw new AppError('Authentication required for this endpoint.', 401, 'UNAUTHORIZED');
    }

    req.authUser = await verifyFirebaseIdToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

export async function socketFirebaseAuth(socket: Socket, next: (err?: Error) => void) {
  try {
    const handshakeAuth = socket.handshake.auth as { token?: string } | undefined;
    const headerAuth = socket.handshake.headers.authorization || '';
    const bearer = headerAuth.startsWith('Bearer ') ? headerAuth.slice(7).trim() : '';
    const token = handshakeAuth?.token || bearer;

    if (!token) {
      next(new Error('UNAUTHORIZED: Authentication token required for Socket.IO connection'));
      return;
    }

    const verified = await verifyFirebaseIdToken(token);
    socket.data.authUser = verified;
    next();
  } catch (err) {
    next(
      new Error(
        err instanceof Error ? `UNAUTHORIZED: ${err.message}` : 'UNAUTHORIZED: Invalid socket token',
      ),
    );
  }
}
