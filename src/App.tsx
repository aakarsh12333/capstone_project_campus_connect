import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { LogOut, Moon, Sun, Trash2, Wifi, WifiOff, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnalyticsView } from './components/AnalyticsView';
import { AuthGate } from './components/AuthGate';
import { Campus3DScene } from './components/Campus3DScene';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MessagesView } from './components/MessagesView';
import { ModerationView } from './components/ModerationView';
import { ProfileSyncView } from './components/ProfileSyncView';
import { ResourcesView } from './components/ResourcesView';
import { SidebarNav } from './components/SidebarNav';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { useCampusSocket } from './hooks/useCampusSocket';
import { useOfflineSyncState } from './hooks/useOfflineSyncState';
import { deleteCampusGroup, ensureUserProfilesAndDefaultGroups } from './services/campusService';
import { syncPendingLocalUploads } from './services/localFileStore';
import type {
  AcademicResource,
  CampusGroup,
  EngagementEvent,
  GroupInvitation,
  GroupMember,
  GroupMessage,
  ModerationReport,
  PrimaryPage,
  UserPrivateInfo,
  UserPublicProfile,
} from './types/campus';

const MESSAGE_PAGE_STEP = 25;

function CampusConnectApp() {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('campus-connect-theme') === 'dark';
  });

  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profileReady, setProfileReady] = useState(false);

  const [currentProfile, setCurrentProfile] = useState<UserPublicProfile | null>(null);
  const [privateInfo, setPrivateInfo] = useState<UserPrivateInfo | null>(null);
  const [directoryUsers, setDirectoryUsers] = useState<UserPublicProfile[]>([]);
  const [publicGroups, setPublicGroups] = useState<CampusGroup[]>([]);
  const [ownGroups, setOwnGroups] = useState<CampusGroup[]>([]);
  const [directGroups, setDirectGroups] = useState<CampusGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string>('cs402-distributed-systems');

  const [isActiveGroupMember, setIsActiveGroupMember] = useState(false);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [messageLimit, setMessageLimit] = useState<number>(MESSAGE_PAGE_STEP);
  const [hasMoreMessages, setHasMoreMessages] = useState<boolean>(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  const [resourcesByGroup, setResourcesByGroup] = useState<Record<string, AcademicResource[]>>({});
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [moderationReports, setModerationReports] = useState<ModerationReport[]>([]);
  const [userEvents, setUserEvents] = useState<EngagementEvent[]>([]);

  const [activePage, setActivePage] = useState<PrimaryPage>('messages');
  const [focusBuildingId, setFocusBuildingId] = useState<string | null>(null);
  const [mobileChannelDrawerOpen, setMobileChannelDrawerOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [startDmOpen, setStartDmOpen] = useState(false);
  const [groupPendingDelete, setGroupPendingDelete] = useState<CampusGroup | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [hiddenDeletedGroupIds, setHiddenDeletedGroupIds] = useState<string[]>([]);

  const { isOnline, lastSyncedAt, syncCount } = useOfflineSyncState();

  const handleUnreadGroupMessage = useCallback((groupId: string) => {
    setUnreadCounts((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] || 0) + 1,
    }));
  }, []);

  const {
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
  } = useCampusSocket({
    uid: currentUser?.uid,
    displayName: currentProfile?.displayName || currentUser?.displayName || undefined,
    role: currentProfile?.role,
    department: currentProfile?.department,
    activeGroupId,
    notificationsEnabled: privateInfo?.notificationsEnabled ?? true,
    onUnreadGroupMessage: handleUnreadGroupMessage,
  });

  // Sync dark mode class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('campus-connect-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // Flush any offline-queued local resource file uploads when reconnected
  useEffect(() => {
    if (isOnline && currentUser) {
      syncPendingLocalUploads().catch(() => {});
    }
  }, [isOnline, currentUser]);

  // Auth listener & initial profile/seed sync
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setAuthReady(true);
      if (user) {
        setProfileReady(false);
        try {
          const { publicProfile, privateInfo: priv } = await ensureUserProfilesAndDefaultGroups(user);
          setCurrentProfile(publicProfile);
          setPrivateInfo(priv);
          if (publicProfile.themePreference === 'dark' || publicProfile.themePreference === 'light') {
            setDarkMode(publicProfile.themePreference === 'dark');
          }
        } finally {
          setProfileReady(true);
        }
      } else {
        setProfileReady(false);
        setCurrentProfile(null);
        setPrivateInfo(null);
      }
    });
    return () => unsub();
  }, []);

  // Core Firestore real-time listeners (strictly gated on authReady + currentUser + profileReady)
  useEffect(() => {
    if (!authReady || !currentUser || !profileReady) return;
    const uid = currentUser.uid;
    const isAdminUser = currentProfile?.role === 'platform_admin';

    const unsubPublic = onSnapshot(
      doc(db, 'usersPublic', uid),
      (snap) => {
        if (snap.exists()) {
          setCurrentProfile(snap.data() as UserPublicProfile);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `usersPublic/${uid}`),
    );

    const unsubPrivate = onSnapshot(
      doc(db, 'usersPrivate', uid),
      (snap) => {
        if (snap.exists()) {
          setPrivateInfo(snap.data() as UserPrivateInfo);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `usersPrivate/${uid}`),
    );

    const directoryQuery = query(
      collection(db, 'usersPublic'),
      where('role', 'in', ['student', 'faculty', 'group_admin', 'platform_admin']),
      limit(50),
    );
    const unsubDirectory = onSnapshot(
      directoryQuery,
      (snap) => {
        setDirectoryUsers(snap.docs.map((d) => d.data() as UserPublicProfile));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'usersPublic'),
    );

    const publicGroupsQuery = query(collection(db, 'groups'), where('isPrivate', '==', false));
    const unsubPublicGroups = onSnapshot(
      publicGroupsQuery,
      (snap) => {
        setPublicGroups(snap.docs.map((d) => d.data() as CampusGroup));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'groups'),
    );

    const ownGroupsQuery = query(collection(db, 'groups'), where('creatorId', '==', uid));
    const unsubOwnGroups = onSnapshot(
      ownGroupsQuery,
      (snap) => {
        setOwnGroups(snap.docs.map((d) => d.data() as CampusGroup));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'groups'),
    );

    const directGroupsQuery = query(
      collection(db, 'groups'),
      where('participantIds', 'array-contains', uid),
    );
    const unsubDirectGroups = onSnapshot(
      directGroupsQuery,
      (snap) => {
        setDirectGroups(snap.docs.map((d) => d.data() as CampusGroup));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'groups'),
    );

    const invitesQuery = query(collection(db, 'invitations'), where('inviteeId', '==', uid));
    const unsubInvites = onSnapshot(
      invitesQuery,
      (snap) => {
        setInvitations(snap.docs.map((d) => d.data() as GroupInvitation));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'invitations'),
    );

    const reportsQuery = isAdminUser
      ? query(collection(db, 'moderationReports'), limit(60))
      : query(collection(db, 'moderationReports'), where('reporterId', '==', uid), limit(30));
    const unsubReports = onSnapshot(
      reportsQuery,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as ModerationReport);
        list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setModerationReports(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'moderationReports'),
    );

    const eventsQuery = query(
      collection(db, 'analyticsEvents'),
      where('userId', '==', uid),
      limit(60),
    );
    const unsubEvents = onSnapshot(
      eventsQuery,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as EngagementEvent);
        list.sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
        setUserEvents(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'analyticsEvents'),
    );

    return () => {
      unsubPublic();
      unsubPrivate();
      unsubDirectory();
      unsubPublicGroups();
      unsubOwnGroups();
      unsubDirectGroups();
      unsubInvites();
      unsubReports();
      unsubEvents();
    };
  }, [authReady, currentUser, profileReady, currentProfile?.role]);

  const groups = useMemo(() => {
    const hidden = new Set(hiddenDeletedGroupIds);
    const map = new Map<string, CampusGroup>();
    for (const g of publicGroups) {
      if (!hidden.has(g.id)) map.set(g.id, g);
    }
    for (const g of ownGroups) {
      if (!hidden.has(g.id)) map.set(g.id, g);
    }
    for (const g of directGroups) {
      if (!hidden.has(g.id)) map.set(g.id, g);
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [publicGroups, ownGroups, directGroups, hiddenDeletedGroupIds]);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) || groups[0] || null,
    [groups, activeGroupId],
  );

  const activeMemberRole = useMemo(
    () => members.find((m) => m.uid === currentUser?.uid)?.groupRole || null,
    [members, currentUser?.uid],
  );

  // Reset pagination & clear unread badge when switching rooms
  useEffect(() => {
    if (!activeGroup?.id) return;
    setMessageLimit(MESSAGE_PAGE_STEP);
    setUnreadCounts((prev) => {
      if (!prev[activeGroup.id]) return prev;
      const next = { ...prev };
      delete next[activeGroup.id];
      return next;
    });
  }, [activeGroup?.id]);

  // Check membership doc first before attaching subcollection listeners (Master Gate compliance)
  useEffect(() => {
    if (!authReady || !currentUser || !profileReady || !activeGroup?.id) {
      setIsActiveGroupMember(false);
      setMembers([]);
      setMessages([]);
      setHasMoreMessages(false);
      return;
    }

    const memberDocRef = doc(db, 'groups', activeGroup.id, 'members', currentUser.uid);
    const unsubMembership = onSnapshot(
      memberDocRef,
      (snap) => {
        setIsActiveGroupMember(snap.exists());
      },
      (err) =>
        handleFirestoreError(
          err,
          OperationType.GET,
          `groups/${activeGroup.id}/members/${currentUser.uid}`,
        ),
    );

    return () => unsubMembership();
  }, [authReady, currentUser, profileReady, activeGroup?.id]);

  // Attach subcollection listeners once membership is confirmed (with paginated chronological messages)
  useEffect(() => {
    if (!authReady || !currentUser || !profileReady || !activeGroup?.id || !isActiveGroupMember) {
      setMembers([]);
      setMessages([]);
      setHasMoreMessages(false);
      return;
    }

    const gid = activeGroup.id;
    const unsubMembers = onSnapshot(
      collection(db, 'groups', gid, 'members'),
      (snap) => {
        setMembers(snap.docs.map((d) => d.data() as GroupMember));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `groups/${gid}/members`),
    );

    const msgsQuery = query(
      collection(db, 'groups', gid, 'messages'),
      orderBy('createdAt', 'desc'),
      limit(messageLimit + 1),
    );
    const unsubMsgs = onSnapshot(
      msgsQuery,
      { includeMetadataChanges: true },
      (snap) => {
        const docs = snap.docs;
        setHasMoreMessages(docs.length > messageLimit);
        const pageDocs = docs.slice(0, messageLimit);
        // Deduplicate by message ID and sort chronologically ascending
        const deduped = new Map<string, GroupMessage>();
        pageDocs.forEach((d) => {
          const data = d.data() as GroupMessage;
          deduped.set(data.id || d.id, {
            ...data,
            id: data.id || d.id,
            _pendingWrite: d.metadata.hasPendingWrites,
            _fromCache: d.metadata.fromCache,
          });
        });
        const chronological = Array.from(deduped.values()).reverse();
        setMessages(chronological);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `groups/${gid}/messages`),
    );

    const unsubResources = onSnapshot(
      collection(db, 'groups', gid, 'resources'),
      (snap) => {
        setResourcesByGroup((prev) => ({
          ...prev,
          [gid]: snap.docs.map((d) => d.data() as AcademicResource),
        }));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `groups/${gid}/resources`),
    );

    return () => {
      unsubMembers();
      unsubMsgs();
      unsubResources();
    };
  }, [authReady, currentUser, profileReady, activeGroup?.id, isActiveGroupMember, messageLimit]);

  const pendingInvitesCount = useMemo(
    () =>
      invitations.filter(
        (inv) => inv.status === 'pending' && inv.inviteeId === currentUser?.uid,
      ).length,
    [invitations, currentUser?.uid],
  );

  const openReportsCount = useMemo(
    () => moderationReports.filter((r) => r.status === 'open').length,
    [moderationReports],
  );

  const handleSelectGroup = useCallback((gid: string) => {
    setActiveGroupId(gid);
    setActivePage('messages');
    setUnreadCounts((prev) => {
      if (!prev[gid]) return prev;
      const next = { ...prev };
      delete next[gid];
      return next;
    });
  }, []);

  const handleConfirmDeleteGroup = async () => {
    if (!groupPendingDelete || !currentUser) return;
    const targetId = groupPendingDelete.id;
    setDeletingGroup(true);
    try {
      const remaining = groups.filter((g) => g.id !== targetId);
      setHiddenDeletedGroupIds((prev) => (prev.includes(targetId) ? prev : [...prev, targetId]));
      if (activeGroup?.id === targetId || activeGroupId === targetId) {
        setActiveGroupId(remaining[0]?.id || '');
        setIsActiveGroupMember(false);
        setMembers([]);
        setMessages([]);
      }
      setResourcesByGroup((prev) => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      await deleteCampusGroup({ groupId: targetId, uid: currentUser.uid });
      setGroupPendingDelete(null);
    } finally {
      setDeletingGroup(false);
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf8ff] dark:bg-[#0B0F19] text-sm text-slate-500 dark:text-slate-400">
        Initializing Campus Connect workspace...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthGate darkMode={darkMode} onToggleDarkMode={() => setDarkMode((d) => !d)} />
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col md:flex-row bg-[#faf8ff] dark:bg-[#0B0F19] text-[#171b26] dark:text-[#eef0ff]">
      {/* Compact Mobile Top Bar (<768px) */}
      <header className="md:hidden h-12 px-4 flex items-center justify-between bg-white dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800 shrink-0 z-30">
        <span className="font-display font-bold text-sm tracking-tight">Campus Connect</span>
        <div className="flex items-center gap-2">
          <span
            title={isOnline ? 'Online' : 'Offline Cache'}
            className="inline-flex items-center justify-center w-8 h-8"
          >
            {isOnline ? (
              <Wifi className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            )}
          </span>
          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            aria-label="Toggle color theme"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => signOut(auth)}
            aria-label="Sign out"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <SidebarNav
        activePage={activePage}
        onSelectPage={setActivePage}
        groups={groups}
        activeGroupId={activeGroup?.id || activeGroupId}
        activeMemberRole={activeMemberRole}
        unreadCounts={unreadCounts}
        onSelectGroup={handleSelectGroup}
        onOpenCreateGroup={() => {
          setActivePage('messages');
          setCreateGroupOpen(true);
        }}
        onOpenStartDirectMessage={() => {
          setActivePage('messages');
          setStartDmOpen(true);
        }}
        onRequestDeleteGroup={(grp) => setGroupPendingDelete(grp)}
        profile={currentProfile}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        isOnline={isOnline}
        socketConnected={socketConnected}
        pendingInvitationsCount={pendingInvitesCount}
        openReportsCount={openReportsCount}
        onSignOut={() => signOut(auth)}
        mobileChannelDrawerOpen={mobileChannelDrawerOpen}
        onToggleMobileChannelDrawer={setMobileChannelDrawerOpen}
      />

      {/* Primary Animated Page Viewport */}
      <main className="relative flex-1 flex min-w-0 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={activePage}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 flex min-w-0 min-h-0 overflow-hidden"
          >
            {activePage === 'messages' && (
              <MessagesView
                currentProfile={currentProfile}
                groups={groups}
                activeGroup={activeGroup}
                onSelectGroup={handleSelectGroup}
                messages={messages}
                hasMoreMessages={hasMoreMessages}
                onLoadMoreMessages={() => setMessageLimit((n) => n + MESSAGE_PAGE_STEP)}
                members={members}
                directoryUsers={directoryUsers}
                invitations={invitations}
                onlineMembers={onlineMembers}
                typingInActiveGroup={activeGroup ? typingUsers[activeGroup.id] || {} : {}}
                onEmitTyping={emitTyping}
                onBroadcastMessage={emitMessageBroadcast}
                onEmitMessageRead={emitMessageRead}
                onNotifyInvitation={emitInvitationNotify}
                onEmitModerationAlert={emitModerationAlert}
                onInspectBuildingIn3D={(bId) => {
                  setFocusBuildingId(bId);
                  setActivePage('campus3d');
                }}
                onOpenMobileChannels={() => setMobileChannelDrawerOpen(true)}
                createGroupOpen={createGroupOpen}
                onSetCreateGroupOpen={setCreateGroupOpen}
                startDmOpen={startDmOpen}
                onSetStartDmOpen={setStartDmOpen}
                onRequestDeleteGroup={(grp) => setGroupPendingDelete(grp)}
              />
            )}

            {activePage === 'resources' && (
              <ResourcesView
                profile={currentProfile}
                groups={groups}
                resourcesByGroup={resourcesByGroup}
              />
            )}

            {activePage === 'campus3d' && (
              <Campus3DScene
                darkMode={darkMode}
                profile={currentProfile}
                groups={groups}
                initialFocusBuildingId={focusBuildingId}
                onOpenChannel={handleSelectGroup}
              />
            )}

            {activePage === 'analytics' && (
              <AnalyticsView userEvents={userEvents} isOnline={isOnline} />
            )}

            {activePage === 'moderation' && (
              <ModerationView
                currentProfile={currentProfile}
                reports={moderationReports}
                directoryUsers={directoryUsers}
                onEmitAnnouncement={emitAnnouncement}
              />
            )}

            {activePage === 'profile' && (
              <ProfileSyncView
                profile={currentProfile}
                privateInfo={privateInfo}
                darkMode={darkMode}
                onToggleDarkMode={() => setDarkMode((d) => !d)}
                isOnline={isOnline}
                lastSyncedAt={lastSyncedAt}
                syncCount={syncCount}
                socketConnected={socketConnected}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Socket.IO Real-Time Notification Stack */}
        {notifications.length > 0 && (
          <div className="fixed top-14 md:top-4 right-4 z-50 space-y-2 max-w-xs w-full pointer-events-none">
            {notifications.slice(0, 2).map((n) => (
              <div
                key={n.id}
                className="pointer-events-auto bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 rounded-xl p-3.5 shadow-lg flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold font-display text-[#3525cd] dark:text-[#a5b4fc] truncate">
                    {n.title}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">
                    {n.body}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => dismissNotification(n.id)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Confirm Delete Room Modal */}
        {groupPendingDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-room-title"
              className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 id="delete-room-title" className="text-base font-bold font-display">
                      Delete {groupPendingDelete.code}?
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {groupPendingDelete.name}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={deletingGroup}
                  onClick={() => setGroupPendingDelete(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-5">
                This permanently deletes this active room along with its channel messages, shared academic resources, and roster records.
              </p>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={deletingGroup}
                  onClick={() => setGroupPendingDelete(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingGroup}
                  onClick={handleConfirmDeleteGroup}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{deletingGroup ? 'Deleting...' : 'Delete Room'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <CampusConnectApp />
    </ErrorBoundary>
  );
}
