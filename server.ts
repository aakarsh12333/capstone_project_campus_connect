import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { campusEmitter } from './server/events/campusEmitter.ts';
import {
  getArchitectureCatalog,
  getEngagementReport,
  getHealth,
  recordAnalyticsEvent,
} from './server/controllers/reportsController.ts';
import {
  downloadLocalResource,
  uploadLocalResource,
} from './server/controllers/resourcesController.ts';
import { errorHandler, requestLogger } from './server/middleware/errorHandler.ts';
import {
  requireFirebaseAuth,
  socketFirebaseAuth,
  type VerifiedFirebaseUser,
} from './server/middleware/firebaseAuth.ts';

interface PresenceUser {
  socketId: string;
  uid: string;
  displayName: string;
  role: string;
  department: string;
  activeGroupId?: string;
  connectedAt: string;
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Enforce authenticated Socket.IO connections (Business Rule 1)
  io.use(socketFirebaseAuth);

  // Authenticated binary local resource upload must run before express.json()
  app.post(
    '/api/resources/upload',
    requireFirebaseAuth,
    express.raw({ type: '*/*', limit: '20mb' }),
    uploadLocalResource,
  );
  app.get('/api/resources/files/:fileId', requireFirebaseAuth, downloadLocalResource);

  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  // REST API Routes (MVC Router Layer)
  app.get('/api/health', getHealth);
  app.get('/api/architecture/endpoints', getArchitectureCatalog);
  app.get('/api/reports/engagement', requireFirebaseAuth, getEngagementReport);
  app.post('/api/analytics/event', requireFirebaseAuth, recordAnalyticsEvent);

  // Presence & Real-Time Socket.IO Handlers
  const connectedUsers = new Map<string, PresenceUser>();
  const recentBroadcastIds = new Set<string>();

  const broadcastPresence = () => {
    const uniqueByUid = new Map<string, PresenceUser>();
    for (const user of connectedUsers.values()) {
      uniqueByUid.set(user.uid, user);
    }
    io.emit('presence:list', Array.from(uniqueByUid.values()));
  };

  io.on('connection', (socket) => {
    const authUser = socket.data.authUser as VerifiedFirebaseUser;

    socket.on(
      'presence:identify',
      (payload: { displayName?: string; role?: string; department?: string }) => {
        connectedUsers.set(socket.id, {
          socketId: socket.id,
          uid: authUser.uid,
          displayName: (payload?.displayName || authUser.name || 'Campus Member').slice(0, 80),
          role: (payload?.role || 'student').slice(0, 30),
          department: (payload?.department || 'Computer Science').slice(0, 80),
          connectedAt: new Date().toISOString(),
        });
        broadcastPresence();
      },
    );

    socket.on('room:join', (groupId: string) => {
      if (typeof groupId !== 'string' || !groupId) return;
      socket.join(`group:${groupId}`);
      const user = connectedUsers.get(socket.id);
      if (user) {
        user.activeGroupId = groupId;
        broadcastPresence();
      }
    });

    socket.on('room:leave', (groupId: string) => {
      if (typeof groupId !== 'string' || !groupId) return;
      socket.leave(`group:${groupId}`);
    });

    socket.on('typing:start', (payload: { groupId: string; displayName: string }) => {
      if (!payload?.groupId) return;
      socket.to(`group:${payload.groupId}`).emit('typing:update', {
        groupId: payload.groupId,
        uid: authUser.uid,
        displayName: (payload.displayName || authUser.name || 'Scholar').slice(0, 80),
        isTyping: true,
      });
    });

    socket.on('typing:stop', (payload: { groupId: string; displayName: string }) => {
      if (!payload?.groupId) return;
      socket.to(`group:${payload.groupId}`).emit('typing:update', {
        groupId: payload.groupId,
        uid: authUser.uid,
        displayName: (payload.displayName || authUser.name || 'Scholar').slice(0, 80),
        isTyping: false,
      });
    });

    socket.on(
      'message:broadcast',
      (payload: {
        messageId?: string;
        groupId: string;
        groupName: string;
        senderName: string;
        preview: string;
        isDirect?: boolean;
        recipientUid?: string;
        wasOffline?: boolean;
      }) => {
        if (!payload?.groupId) return;
        const dedupKey = payload.messageId || `${payload.groupId}:${authUser.uid}:${payload.preview.slice(0, 40)}`;
        if (recentBroadcastIds.has(dedupKey)) return;
        recentBroadcastIds.add(dedupKey);
        if (recentBroadcastIds.size > 500) {
          const oldest = recentBroadcastIds.values().next().value;
          if (oldest) recentBroadcastIds.delete(oldest);
        }

        const senderRole = connectedUsers.get(socket.id)?.role || 'student';
        campusEmitter.emit('message-created', {
          type: 'message-created',
          userId: authUser.uid,
          userRole: senderRole,
          groupId: payload.groupId,
          wasOffline: Boolean(payload.wasOffline),
          timestamp: new Date().toISOString(),
        });

        const notifPayload = {
          id: payload.messageId || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          kind: 'message' as const,
          groupId: payload.groupId,
          title: payload.isDirect
            ? `Direct Message from ${payload.senderName}`
            : `${payload.senderName} in ${payload.groupName}`,
          body: payload.preview.slice(0, 90),
          timestamp: new Date().toISOString(),
        };

        if (payload.isDirect && payload.recipientUid) {
          for (const [sockId, user] of connectedUsers.entries()) {
            if (user.uid === payload.recipientUid) {
              io.to(sockId).emit('notification:new', notifPayload);
            }
          }
        } else {
          socket.broadcast.emit('notification:new', notifPayload);
        }
      },
    );

    socket.on('message:read', (payload: { groupId: string; messageIds: string[] }) => {
      if (!payload?.groupId || !Array.isArray(payload.messageIds)) return;
      socket.to(`group:${payload.groupId}`).emit('message:read-ack', {
        groupId: payload.groupId,
        readerUid: authUser.uid,
        messageIds: payload.messageIds.slice(0, 50),
      });
    });

    socket.on('invitation:notify', (payload: { inviteeId: string; inviterName: string; groupName: string }) => {
      if (!payload?.inviteeId) return;
      campusEmitter.emit('invitation-created', {
        type: 'invitation-created',
        userId: authUser.uid,
        userRole: connectedUsers.get(socket.id)?.role || 'student',
        timestamp: new Date().toISOString(),
      });

      for (const [sockId, user] of connectedUsers.entries()) {
        if (user.uid === payload.inviteeId) {
          io.to(sockId).emit('notification:new', {
            id: `${Date.now()}-inv`,
            kind: 'invitation',
            title: 'Channel Invitation',
            body: `${payload.inviterName} invited you to ${payload.groupName}`,
            timestamp: new Date().toISOString(),
          });
        }
      }
    });

    socket.on(
      'announcement:broadcast',
      (payload: { title: string; body: string; authorName: string; authorRole: string }) => {
        if (!payload?.title || !payload?.body) return;
        const userRole = connectedUsers.get(socket.id)?.role || payload.authorRole || 'student';
        if (userRole !== 'platform_admin' && userRole !== 'faculty') return;

        campusEmitter.emit('announcement-created', {
          type: 'announcement-created',
          userId: authUser.uid,
          userRole,
          timestamp: new Date().toISOString(),
        });

        io.emit('notification:new', {
          id: `${Date.now()}-ann`,
          kind: 'announcement',
          title: `Campus Announcement: ${payload.title.slice(0, 60)}`,
          body: `${payload.body.slice(0, 120)} — ${payload.authorName}`,
          timestamp: new Date().toISOString(),
        });
      },
    );

    socket.on(
      'moderation:alert',
      (payload: { reportId: string; groupCode: string; reason: string; reporterName: string }) => {
        if (!payload?.reportId) return;
        campusEmitter.emit('moderation-reported', {
          type: 'moderation-reported',
          userId: authUser.uid,
          userRole: connectedUsers.get(socket.id)?.role || 'student',
          timestamp: new Date().toISOString(),
        });

        for (const [sockId, user] of connectedUsers.entries()) {
          if (user.role === 'platform_admin' && user.uid !== authUser.uid) {
            io.to(sockId).emit('notification:new', {
              id: `${Date.now()}-mod`,
              kind: 'moderation',
              title: `Moderation Alert (${payload.groupCode})`,
              body: `${payload.reporterName} flagged a message for ${payload.reason.replace('_', ' ')}.`,
              timestamp: new Date().toISOString(),
            });
          }
        }
      },
    );

    socket.on('disconnect', () => {
      connectedUsers.delete(socket.id);
      broadcastPresence();
    });
  });

  app.use(errorHandler);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.info(`Campus Connect server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Campus Connect server:', err);
  process.exit(1);
});
