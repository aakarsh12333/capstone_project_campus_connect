import type { NextFunction, Request, Response } from 'express';
import { campusEmitter, type CampusEventType } from '../events/campusEmitter.ts';
import { AppError } from '../middleware/errorHandler.ts';

const VALID_EVENT_TYPES = new Set<CampusEventType>([
  'message-created',
  'invitation-created',
  'resource-shared',
  'moderation-reported',
  'announcement-created',
  'analytics-recorded',
]);

export function getHealth(_req: Request, res: Response) {
  res.json({
    success: true,
    service: 'campus-connect-api',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
}

export function getEngagementReport(req: Request, res: Response, next: NextFunction) {
  try {
    const rangeParam = typeof req.query.range === 'string' ? req.query.range : '7d';
    const range = ['24h', '7d', '30d'].includes(rangeParam) ? rangeParam : '7d';
    const summary = campusEmitter.getAggregatedSummary(range);
    res.json({
      success: true,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
}

export function recordAnalyticsEvent(req: Request, res: Response, next: NextFunction) {
  try {
    const { type, userId, userRole, groupId, department, latencyMs, wasOffline } = req.body ?? {};
    const verifiedUid = req.authUser?.uid || userId;

    if (!type || !VALID_EVENT_TYPES.has(type)) {
      throw new AppError('Invalid or missing CampusEventType', 400, 'VALIDATION_ERROR');
    }
    if (!verifiedUid || typeof verifiedUid !== 'string') {
      throw new AppError('Missing valid userId', 400, 'VALIDATION_ERROR');
    }

    const payload = {
      type: type as CampusEventType,
      userId: verifiedUid.slice(0, 128),
      userRole: typeof userRole === 'string' ? userRole.slice(0, 30) : 'student',
      groupId: typeof groupId === 'string' ? groupId.slice(0, 128) : undefined,
      department: typeof department === 'string' ? department.slice(0, 80) : undefined,
      latencyMs: typeof latencyMs === 'number' ? Math.max(0, Math.min(latencyMs, 60000)) : 12,
      wasOffline: Boolean(wasOffline),
      timestamp: new Date().toISOString(),
    };

    campusEmitter.emit(payload.type, payload);

    res.status(201).json({
      success: true,
      data: payload,
    });
  } catch (err) {
    next(err);
  }
}

export function getArchitectureCatalog(_req: Request, res: Response) {
  res.json({
    success: true,
    project: 'Project 3: Real-Time Campus Collaboration and Communication Platform',
    endpoints: [
      { method: 'GET', path: '/api/health', description: 'API and Socket.IO health verification' },
      { method: 'POST', path: '/api/resources/upload', description: 'Authenticated local academic file upload (allowlisted formats, 20 MB max)' },
      { method: 'GET', path: '/api/resources/files/:fileId', description: 'Authenticated local academic resource file download' },
      { method: 'GET', path: '/api/reports/engagement?range=24h|7d|30d', description: 'Authenticated campus engagement metrics & channel pipelines' },
      { method: 'POST', path: '/api/analytics/event', description: 'Authenticated internal EventEmitter analytics event ingestion' },
      { method: 'GET', path: '/api/architecture/endpoints', description: 'REST API & Socket.IO event contract documentation' },
    ],
    socketEvents: [
      { event: 'handshake auth (JWT)', direction: 'client -> server', purpose: 'Cryptographic Firebase ID token verification before socket connect' },
      { event: 'presence:identify', direction: 'client -> server', purpose: 'Register authenticated user socket presence & role' },
      { event: 'room:join / room:leave', direction: 'client -> server', purpose: 'Subscribe/unsubscribe to group or 1-to-1 DM room updates' },
      { event: 'typing:start / typing:stop', direction: 'bidirectional', purpose: 'Live zero-latency typing indicators for groups and DMs' },
      { event: 'message:broadcast / message:read', direction: 'bidirectional', purpose: 'Persisted-first message delivery, unread counts, and read receipts' },
      { event: 'invitation:notify', direction: 'bidirectional', purpose: 'Deliver real-time group invitation alerts' },
      { event: 'announcement:broadcast', direction: 'bidirectional', purpose: 'Broadcast important faculty/admin campus announcements' },
      { event: 'moderation:alert', direction: 'bidirectional', purpose: 'Notify platform administrators of newly reported messages' },
    ],
  });
}
