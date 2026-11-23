import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getFirebaseIdToken } from '../services/authToken';

export interface OnlineMember {
  socketId: string;
  uid: string;
  displayName: string;
  role: string;
  department: string;
  activeGroupId?: string;
  connectedAt: string;
}

export interface LiveNotification {
  id: string;
  kind: 'message' | 'invitation' | 'announcement' | 'moderation' | 'system';
  groupId?: string;
  title: string;
  body: string;
  timestamp: string;
}

export function useCampusSocket(params: {
  uid?: string;
  displayName?: string;
  role?: string;
  department?: string;
  activeGroupId?: string;
  notificationsEnabled?: boolean;
  onUnreadGroupMessage?: (groupId: string) => void;
}) {
  const socketRef = useRef<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [onlineMembers, setOnlineMembers] = useState<OnlineMember[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, Record<string, string>>>({});
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);
  const prevGroupRef = useRef<string | undefined>(undefined);
  const activeGroupRef = useRef<string | undefined>(params.activeGroupId);
  const notifEnabledRef = useRef<boolean>(params.notificationsEnabled ?? true);
  const onUnreadRef = useRef(params.onUnreadGroupMessage);

  useEffect(() => {
    activeGroupRef.current = params.activeGroupId;
  }, [params.activeGroupId]);

  useEffect(() => {
    notifEnabledRef.current = params.notificationsEnabled ?? true;
  }, [params.notificationsEnabled]);

  useEffect(() => {
    onUnreadRef.current = params.onUnreadGroupMessage;
  }, [params.onUnreadGroupMessage]);

  useEffect(() => {
    if (!params.uid) return;

    const socket = io({
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 12,
      reconnectionDelay: 1200,
      auth: (cb) => {
        getFirebaseIdToken()
          .then((token) => cb({ token: token || '' }))
          .catch(() => cb({ token: '' }));
      },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('presence:identify', {
        displayName: params.displayName || 'Campus Scholar',
        role: params.role || 'student',
        department: params.department || 'Computer Science',
      });
      if (activeGroupRef.current) {
        socket.emit('room:join', activeGroupRef.current);
      }
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('presence:list', (list: OnlineMember[]) => {
      setOnlineMembers(Array.isArray(list) ? list : []);
    });

    socket.on(
      'typing:update',
      (payload: { groupId: string; uid: string; displayName: string; isTyping: boolean }) => {
        if (!payload?.groupId || !payload?.uid || payload.uid === params.uid) return;
        setTypingUsers((prev) => {
          const groupMap = { ...(prev[payload.groupId] || {}) };
          if (payload.isTyping) {
            groupMap[payload.uid] = payload.displayName;
          } else {
            delete groupMap[payload.uid];
          }
          return { ...prev, [payload.groupId]: groupMap };
        });
      },
    );

    socket.on('notification:new', (notif: LiveNotification) => {
      if (notif.kind === 'message' && notif.groupId && notif.groupId !== activeGroupRef.current) {
        onUnreadRef.current?.(notif.groupId);
      }
      if (!notifEnabledRef.current && notif.kind !== 'announcement' && notif.kind !== 'moderation') {
        return;
      }
      setNotifications((prev) => {
        if (prev.some((existing) => existing.id === notif.id)) return prev;
        return [notif, ...prev].slice(0, 6);
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setSocketConnected(false);
    };
  }, [params.uid]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    socket.emit('presence:identify', {
      displayName: params.displayName || 'Campus Scholar',
      role: params.role || 'student',
      department: params.department || 'Computer Science',
    });
  }, [params.uid, params.displayName, params.role, params.department]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (prevGroupRef.current && prevGroupRef.current !== params.activeGroupId) {
      socket.emit('room:leave', prevGroupRef.current);
    }
    if (params.activeGroupId && socket.connected) {
      socket.emit('room:join', params.activeGroupId);
    }
    prevGroupRef.current = params.activeGroupId;
  }, [params.activeGroupId, socketConnected]);

  const emitTyping = useCallback(
    (groupId: string, isTyping: boolean) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected || !params.uid) return;
      socket.emit(isTyping ? 'typing:start' : 'typing:stop', {
        groupId,
        displayName: params.displayName || 'Scholar',
      });
    },
    [params.uid, params.displayName],
  );

  const emitMessageBroadcast = useCallback(
    (payload: {
      messageId?: string;
      groupId: string;
      groupName: string;
      senderId: string;
      senderName: string;
      preview: string;
      isDirect?: boolean;
      recipientUid?: string;
      wasOffline?: boolean;
    }) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) return;
      socket.emit('message:broadcast', payload);
    },
    [],
  );

  const emitMessageRead = useCallback((groupId: string, messageIds: string[]) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || messageIds.length === 0) return;
    socket.emit('message:read', { groupId, messageIds });
  }, []);

  const emitInvitationNotify = useCallback(
    (payload: { inviteeId: string; inviterName: string; groupName: string }) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) return;
      socket.emit('invitation:notify', payload);
    },
    [],
  );

  const emitAnnouncement = useCallback(
    (payload: { title: string; body: string; authorName: string; authorRole: string }) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) return;
      socket.emit('announcement:broadcast', payload);
    },
    [],
  );

  const emitModerationAlert = useCallback(
    (payload: { reportId: string; groupCode: string; reason: string; reporterName: string }) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) return;
      socket.emit('moderation:alert', payload);
    },
    [],
  );

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return {
    socketConnected,
    onlineMembers,
    typingUsers,
    notifications,
    emitTyping,
    emitMessageBroadcast,
    emitMessageRead,
    emitInvitationNotify,
    emitAnnouncement,
    emitModerationAlert,
    dismissNotification,
  };
}
