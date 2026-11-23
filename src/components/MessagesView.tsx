import {
  Check,
  CheckCheck,
  ChevronRight,
  Compass,
  Edit3,
  Flag,
  Hash,
  History,
  Info,
  KeyRound,
  Lock,
  Menu,
  MessageCircle,
  MessageSquarePlus,
  Reply,
  Search,
  Send,
  Shield,
  ShieldCheck,
  SmilePlus,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { deleteDoc, doc } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { OnlineMember } from '../hooks/useCampusSocket';
import {
  addGroupMemberDirect,
  CAMPUS_BUILDINGS,
  createCampusGroup,
  createModerationReport,
  getOrCreateDirectMessage,
  joinPublicGroup,
  markMessagesAsRead,
  removeGroupMember,
  respondToGroupInvitation,
  rotateGroupMlsEpoch,
  sendGroupInvitation,
  sendGroupMessage,
  toggleMessageReaction,
  updateCampusGroupDetails,
  updateGroupMemberRole,
} from '../services/campusService';
import {
  REACTION_OPTIONS,
  SCHEMA_LIMITS,
  type CampusGroup,
  type GroupInvitation,
  type GroupMember,
  type GroupMessage,
  type GroupType,
  type ModerationReason,
  type ReactionKey,
  type UserPublicProfile,
} from '../types/campus';

interface MessagesViewProps {
  currentProfile: UserPublicProfile | null;
  groups: CampusGroup[];
  activeGroup: CampusGroup | null;
  onSelectGroup: (groupId: string) => void;
  messages: GroupMessage[];
  hasMoreMessages: boolean;
  onLoadMoreMessages: () => void;
  members: GroupMember[];
  directoryUsers: UserPublicProfile[];
  invitations: GroupInvitation[];
  onlineMembers: OnlineMember[];
  typingInActiveGroup: Record<string, string>;
  onEmitTyping: (groupId: string, isTyping: boolean) => void;
  onBroadcastMessage: (payload: {
    messageId?: string;
    groupId: string;
    groupName: string;
    senderId: string;
    senderName: string;
    preview: string;
    isDirect?: boolean;
    recipientUid?: string;
    wasOffline?: boolean;
  }) => void;
  onEmitMessageRead: (groupId: string, messageIds: string[]) => void;
  onNotifyInvitation: (payload: { inviteeId: string; inviterName: string; groupName: string }) => void;
  onEmitModerationAlert: (payload: {
    reportId: string;
    groupCode: string;
    reason: string;
    reporterName: string;
  }) => void;
  onInspectBuildingIn3D: (buildingId: string) => void;
  onOpenMobileChannels: () => void;
  createGroupOpen: boolean;
  onSetCreateGroupOpen: (open: boolean) => void;
  startDmOpen: boolean;
  onSetStartDmOpen: (open: boolean) => void;
  onRequestDeleteGroup: (group: CampusGroup) => void;
}

export function MessagesView({
  currentProfile,
  groups,
  activeGroup,
  onSelectGroup,
  messages,
  hasMoreMessages,
  onLoadMoreMessages,
  members,
  directoryUsers,
  invitations,
  onlineMembers,
  typingInActiveGroup,
  onEmitTyping,
  onBroadcastMessage,
  onEmitMessageRead,
  onNotifyInvitation,
  onEmitModerationAlert,
  onInspectBuildingIn3D,
  onOpenMobileChannels,
  createGroupOpen,
  onSetCreateGroupOpen,
  startDmOpen,
  onSetStartDmOpen,
  onRequestDeleteGroup,
}: MessagesViewProps) {
  const [composerText, setComposerText] = useState('');
  const [replyTarget, setReplyTarget] = useState<GroupMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [epochMessage, setEpochMessage] = useState<string | null>(null);
  const [openReactionPickerId, setOpenReactionPickerId] = useState<string | null>(null);

  // Edit group details state (for group admins)
  const [editingGroup, setEditingGroup] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPrivate, setEditPrivate] = useState(false);
  const [savingGroupEdit, setSavingGroupEdit] = useState(false);

  // Report message modal state
  const [reportTarget, setReportTarget] = useState<GroupMessage | null>(null);
  const [reportReason, setReportReason] = useState<ModerationReason>('inappropriate');
  const [reportDetails, setReportDetails] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);

  // Direct message modal search
  const [dmSearch, setDmSearch] = useState('');
  const [startingDmUid, setStartingDmUid] = useState<string | null>(null);

  // Create channel modal state
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newType, setNewType] = useState<GroupType>('project');
  const [newBuilding, setNewBuilding] = useState('cs-engineering-wing');
  const [newPrivate, setNewPrivate] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const markedReadRef = useRef<Set<string>>(new Set());

  const isMember = useMemo(() => {
    if (!currentProfile) return false;
    return members.some((m) => m.uid === currentProfile.uid);
  }, [members, currentProfile]);

  const myMemberRole = useMemo(() => {
    if (!currentProfile) return null;
    return members.find((m) => m.uid === currentProfile.uid)?.groupRole || null;
  }, [members, currentProfile]);

  const canManageGroup = Boolean(
    currentProfile &&
      activeGroup &&
      (myMemberRole === 'owner' ||
        myMemberRole === 'admin' ||
        activeGroup.creatorId === currentProfile.uid ||
        currentProfile.role === 'platform_admin'),
  );

  const filteredMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q),
    );
  }, [messages, searchQuery]);

  const onlineUids = useMemo(() => new Set(onlineMembers.map((u) => u.uid)), [onlineMembers]);

  const pendingInvites = useMemo(
    () => invitations.filter((inv) => inv.status === 'pending' && inv.inviteeId === currentProfile?.uid),
    [invitations, currentProfile?.uid],
  );

  const dmCandidates = useMemo(() => {
    const q = dmSearch.trim().toLowerCase();
    return directoryUsers.filter((u) => {
      if (u.uid === currentProfile?.uid) return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
      );
    });
  }, [directoryUsers, currentProfile?.uid, dmSearch]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [filteredMessages.length, activeGroup?.id]);

  // Automatically mark unread messages from other users as 'read' when active channel/DM is viewed
  useEffect(() => {
    if (!activeGroup || !currentProfile || !isMember) return;
    const unreadIds = messages
      .filter(
        (m) =>
          m.senderId !== currentProfile.uid &&
          m.deliveryStatus !== 'read' &&
          !m._pendingWrite &&
          !markedReadRef.current.has(m.id),
      )
      .map((m) => m.id);

    if (unreadIds.length === 0) return;
    unreadIds.forEach((id) => markedReadRef.current.add(id));
    markMessagesAsRead({ groupId: activeGroup.id, messageIds: unreadIds })
      .then(() => onEmitMessageRead(activeGroup.id, unreadIds))
      .catch(() => {});
  }, [activeGroup?.id, currentProfile?.uid, isMember, messages, onEmitMessageRead]);

  useEffect(() => {
    if (activeGroup) {
      setEditName(activeGroup.name);
      setEditDesc(activeGroup.description || '');
      setEditPrivate(activeGroup.isPrivate);
      setEditingGroup(false);
    }
  }, [activeGroup?.id]);

  const handleComposerChange = (value: string) => {
    setComposerText(value);
    if (!activeGroup) return;
    onEmitTyping(activeGroup.id, value.trim().length > 0);
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => {
      onEmitTyping(activeGroup.id, false);
    }, 1800);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGroup || !currentProfile) return;
    const trimmed = composerText.trim();
    if (!trimmed) return;

    setComposerText('');
    onEmitTyping(activeGroup.id, false);

    // Business Rule 5: Persist message in Firestore BEFORE broadcasting via Socket.IO
    const { messageId, queuedOffline } = await sendGroupMessage({
      groupId: activeGroup.id,
      senderId: currentProfile.uid,
      senderName: currentProfile.displayName,
      senderRole: currentProfile.role,
      department: currentProfile.department,
      content: trimmed,
      mlsEpoch: activeGroup.mlsEpoch,
      replyToId: replyTarget?.id,
      replyPreview: replyTarget ? `${replyTarget.senderName}: ${replyTarget.content.slice(0, 80)}` : undefined,
    });

    setReplyTarget(null);

    const peerUid =
      activeGroup.type === 'direct'
        ? activeGroup.participantIds?.find((id) => id !== currentProfile.uid)
        : undefined;

    onBroadcastMessage({
      messageId,
      groupId: activeGroup.id,
      groupName: activeGroup.code,
      senderId: currentProfile.uid,
      senderName: currentProfile.displayName,
      preview: trimmed,
      isDirect: activeGroup.type === 'direct',
      recipientUid: peerUid,
      wasOffline: queuedOffline,
    });
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!activeGroup) return;
    const path = `groups/${activeGroup.id}/messages/${msgId}`;
    try {
      await deleteDoc(doc(db, 'groups', activeGroup.id, 'messages', msgId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const handleToggleReaction = async (msg: GroupMessage, key: ReactionKey) => {
    if (!activeGroup || !currentProfile) return;
    setOpenReactionPickerId(null);
    await toggleMessageReaction({
      groupId: activeGroup.id,
      messageId: msg.id,
      reactionKey: key,
      uid: currentProfile.uid,
      currentReactions: msg.reactions,
    });
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGroup || !currentProfile || !reportTarget) return;
    setSubmittingReport(true);
    try {
      const reportId = await createModerationReport({
        group: activeGroup,
        message: reportTarget,
        reporter: currentProfile,
        reason: reportReason,
        details: reportDetails,
      });
      onEmitModerationAlert({
        reportId,
        groupCode: activeGroup.code,
        reason: reportReason,
        reporterName: currentProfile.displayName,
      });
      setReportTarget(null);
      setReportDetails('');
      setReportFeedback('Message reported to platform administrators for review.');
      window.setTimeout(() => setReportFeedback(null), 3500);
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleJoinChannel = async () => {
    if (!activeGroup || !currentProfile) return;
    await joinPublicGroup({
      groupId: activeGroup.id,
      uid: currentProfile.uid,
      displayName: currentProfile.displayName,
      userRole: currentProfile.role,
      department: currentProfile.department,
    });
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGroup || !currentProfile || !inviteUserId) return;
    setInviteStatus('Sending invitation...');
    await sendGroupInvitation({
      groupId: activeGroup.id,
      groupName: activeGroup.name,
      inviterId: currentProfile.uid,
      inviterName: currentProfile.displayName,
      inviteeId: inviteUserId,
    });
    onNotifyInvitation({
      inviteeId: inviteUserId,
      inviterName: currentProfile.displayName,
      groupName: activeGroup.name,
    });
    setInviteStatus('Invitation dispatched.');
    setInviteUserId('');
    setTimeout(() => setInviteStatus(null), 2500);
  };

  const handleDirectAddMember = async () => {
    if (!activeGroup || !inviteUserId || !canManageGroup) return;
    const target = directoryUsers.find((u) => u.uid === inviteUserId);
    if (!target) return;
    setInviteStatus(`Adding ${target.displayName}...`);
    await addGroupMemberDirect({
      groupId: activeGroup.id,
      memberUid: target.uid,
      memberName: target.displayName,
      groupRole: 'member',
    });
    setInviteStatus(`${target.displayName} added to room.`);
    setInviteUserId('');
    setTimeout(() => setInviteStatus(null), 2500);
  };

  const handleToggleMemberAdmin = async (member: GroupMember) => {
    if (!activeGroup || !canManageGroup || member.groupRole === 'owner') return;
    const nextRole = member.groupRole === 'admin' ? 'member' : 'admin';
    await updateGroupMemberRole({
      groupId: activeGroup.id,
      memberUid: member.uid,
      groupRole: nextRole,
    });
  };

  const handleRemoveMember = async (member: GroupMember) => {
    if (!activeGroup || !canManageGroup || member.groupRole === 'owner') return;
    await removeGroupMember({
      groupId: activeGroup.id,
      memberUid: member.uid,
    });
  };

  const handleSaveGroupDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGroup || !canManageGroup || !editName.trim()) return;
    setSavingGroupEdit(true);
    try {
      await updateCampusGroupDetails({
        groupId: activeGroup.id,
        name: editName,
        description: editDesc,
        isPrivate: editPrivate,
      });
      setEditingGroup(false);
    } finally {
      setSavingGroupEdit(false);
    }
  };

  const handleStartDirectMessage = async (peer: UserPublicProfile) => {
    if (!currentProfile) return;
    setStartingDmUid(peer.uid);
    try {
      const dmGroup = await getOrCreateDirectMessage({
        currentProfile,
        peerProfile: peer,
      });
      onSelectGroup(dmGroup.id);
      onSetStartDmOpen(false);
      setDmSearch('');
    } finally {
      setStartingDmUid(null);
    }
  };

  const handleRotateEpoch = async () => {
    if (!activeGroup) return;
    await rotateGroupMlsEpoch({
      groupId: activeGroup.id,
      currentEpoch: activeGroup.mlsEpoch,
    });
    setEpochMessage(`Rotated to Epoch ${activeGroup.mlsEpoch + 1}`);
    setTimeout(() => setEpochMessage(null), 2500);
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProfile || !newName.trim() || !newCode.trim()) return;
    setCreatingGroup(true);
    try {
      const created = await createCampusGroup({
        name: newName,
        code: newCode,
        description: newDesc,
        type: newType,
        buildingNode: newBuilding,
        isPrivate: newPrivate,
        creatorUid: currentProfile.uid,
        creatorName: currentProfile.displayName,
        creatorRole: currentProfile.role,
        department: currentProfile.department,
      });
      onSelectGroup(created.id);
      onSetCreateGroupOpen(false);
      setNewName('');
      setNewCode('');
      setNewDesc('');
    } finally {
      setCreatingGroup(false);
    }
  };

  const typingNames = Object.values(typingInActiveGroup || {});

  return (
    <div className="flex-1 flex min-w-0 h-full overflow-hidden">
      {/* Main Conversation Stream */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#faf8ff] dark:bg-[#0B0F19]">
        {/* Channel / DM Header */}
        <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-white dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onOpenMobileChannels}
              aria-label="Open channels drawer"
              className="lg:hidden min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {activeGroup?.type === 'direct' ? (
                  <MessageCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : activeGroup?.isPrivate ? (
                  <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <Hash className="w-4 h-4 text-[#4f46e5] dark:text-[#818cf8] shrink-0" />
                )}
                <h1 className="text-base sm:text-lg font-bold font-display truncate">
                  {activeGroup ? `${activeGroup.code} — ${activeGroup.name}` : 'Select a Channel'}
                </h1>
              </div>
              {activeGroup && (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    MLS Epoch {activeGroup.mlsEpoch}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{members.length || activeGroup.memberCount} members</span>
                  {activeGroup.type !== 'direct' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={() => onInspectBuildingIn3D(activeGroup.buildingNode)}
                        className="inline-flex items-center gap-1 text-[#3525cd] dark:text-[#a5b4fc] hover:underline cursor-pointer"
                      >
                        <Compass className="w-3 h-3" />
                        <span>View in 3D</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages"
                className="bg-transparent text-xs outline-none w-32 md:w-44 text-[#171b26] dark:text-[#eef0ff] placeholder:text-slate-400"
              />
            </div>

            <button
              type="button"
              onClick={() => setInspectorOpen((v) => !v)}
              aria-label="Toggle channel security inspector"
              className={`min-h-[40px] px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                inspectorOpen
                  ? 'bg-[#4f46e5] border-[#4f46e5] text-white'
                  : 'bg-white dark:bg-[#111827] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Info className="w-4 h-4" />
              <span className="hidden sm:inline">Inspector</span>
            </button>
          </div>
        </header>

        {/* Report Confirmation Toast */}
        {reportFeedback && (
          <div className="bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-900 px-4 sm:px-6 py-2 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
            {reportFeedback}
          </div>
        )}

        {/* Pending Invitations Banner */}
        {pendingInvites.length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/60 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-amber-900 dark:text-amber-200">
              <span className="font-semibold">Channel Invitation:</span> {pendingInvites[0].inviterName} invited you to{' '}
              <span className="font-semibold">{pendingInvites[0].groupName}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  currentProfile &&
                  respondToGroupInvitation({
                    invitationId: pendingInvites[0].id,
                    groupId: pendingInvites[0].groupId,
                    uid: currentProfile.uid,
                    displayName: currentProfile.displayName,
                    userRole: currentProfile.role,
                    department: currentProfile.department,
                    accept: true,
                  })
                }
                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium cursor-pointer"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() =>
                  currentProfile &&
                  respondToGroupInvitation({
                    invitationId: pendingInvites[0].id,
                    groupId: pendingInvites[0].groupId,
                    uid: currentProfile.uid,
                    displayName: currentProfile.displayName,
                    userRole: currentProfile.role,
                    department: currentProfile.department,
                    accept: false,
                  })
                }
                className="px-3 py-1.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium cursor-pointer"
              >
                Decline
              </button>
            </div>
          </div>
        )}

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
          {!activeGroup ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12">
              <MessageSquarePlus className="w-10 h-10 text-slate-400 mb-3" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-4">
                Select or create an academic channel or 1-to-1 direct message to start collaborating.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSetCreateGroupOpen(true)}
                  className="px-4 py-2 rounded-lg bg-[#4f46e5] hover:bg-[#4338ca] text-white text-sm font-medium cursor-pointer"
                >
                  Create Channel
                </button>
                <button
                  type="button"
                  onClick={() => onSetStartDmOpen(true)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-sm font-medium cursor-pointer"
                >
                  New Direct Message
                </button>
              </div>
            </div>
          ) : !isMember && !activeGroup.isPrivate ? (
            <div className="max-w-md mx-auto my-12 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center">
              <h3 className="text-base font-bold font-display mb-2">Join {activeGroup.name}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                {activeGroup.description || 'Enroll in this open academic channel to access real-time messages and resources.'}
              </p>
              <button
                type="button"
                onClick={handleJoinChannel}
                className="px-5 py-2.5 rounded-lg bg-[#4f46e5] hover:bg-[#4338ca] text-white text-sm font-medium cursor-pointer"
              >
                Join Channel
              </button>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="text-center py-14 text-sm text-slate-500 dark:text-slate-400">
              No messages match your filter yet. Start the discussion below.
            </div>
          ) : (
            <>
              {/* Pagination Control */}
              {hasMoreMessages && !searchQuery.trim() && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={onLoadMoreMessages}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    <History className="w-3.5 h-3.5 text-[#4f46e5] dark:text-[#a5b4fc]" />
                    <span>Load earlier messages</span>
                  </button>
                </div>
              )}

              {filteredMessages.map((msg) => {
                const isOwn = msg.senderId === currentProfile?.uid;
                const timeStr = msg.createdAt?.toDate
                  ? msg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : 'Syncing';

                const activeReactions = REACTION_OPTIONS.filter(
                  (opt) => (msg.reactions?.[opt.key]?.length || 0) > 0,
                );

                return (
                  <article
                    key={msg.id}
                    className="group relative bg-white dark:bg-[#111827] border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 transition-colors hover:border-slate-300 dark:hover:border-slate-700"
                  >
                    {msg.replyPreview && (
                      <div className="mb-2 pl-3 border-l border-slate-300 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 truncate">
                        Replying to {msg.replyPreview}
                      </div>
                    )}

                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs flex-wrap">
                        <span className="font-semibold text-[#171b26] dark:text-[#eef0ff] text-sm">
                          {msg.senderName}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 capitalize">
                          {msg.senderRole.replace('_', ' ')}
                        </span>
                        <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                        <span className="text-slate-500 dark:text-slate-400 tabular-nums">{timeStr}</span>
                        <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                        <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                          E{msg.mlsEpoch}
                        </span>
                        {msg._pendingWrite && (
                          <>
                            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                            <span className="text-amber-600 dark:text-amber-400 font-medium">
                              Queued Offline
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenReactionPickerId((prev) => (prev === msg.id ? null : msg.id))
                          }
                          title="Add reaction"
                          className="p-1.5 rounded-md text-slate-400 hover:text-[#4f46e5] hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <SmilePlus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setReplyTarget(msg)}
                          title="Reply"
                          className="p-1.5 rounded-md text-slate-400 hover:text-[#4f46e5] hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <Reply className="w-3.5 h-3.5" />
                        </button>
                        {!isOwn && (
                          <button
                            type="button"
                            onClick={() => setReportTarget(msg)}
                            title="Report message"
                            className="p-1.5 rounded-md text-slate-400 hover:text-amber-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Flag className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(isOwn || canManageGroup) && (
                          <button
                            type="button"
                            onClick={() => handleDeleteMessage(msg.id)}
                            title="Delete message"
                            className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="mt-2 text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
                      {msg.content}
                    </p>

                    {/* Quick Reaction Picker Popover */}
                    {openReactionPickerId === msg.id && (
                      <div className="mt-2 inline-flex items-center gap-1 p-1 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 shadow-sm">
                        {REACTION_OPTIONS.map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => handleToggleReaction(msg, opt.key)}
                            title={opt.label}
                            className="w-7 h-7 rounded-md hover:bg-white dark:hover:bg-slate-800 text-sm flex items-center justify-center cursor-pointer"
                          >
                            {opt.emoji}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Reactions & Delivery/Read Status Row */}
                    {(activeReactions.length > 0 || isOwn) && (
                      <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {activeReactions.map((opt) => {
                            const uids = msg.reactions?.[opt.key] || [];
                            const reacted = Boolean(currentProfile && uids.includes(currentProfile.uid));
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => handleToggleReaction(msg, opt.key)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs transition-colors cursor-pointer ${
                                  reacted
                                    ? 'bg-[#4f46e5]/10 border-[#4f46e5]/40 text-[#3525cd] dark:text-[#a5b4fc]'
                                    : 'bg-[#faf8ff] dark:bg-[#0B0F19] border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                                }`}
                              >
                                <span>{opt.emoji}</span>
                                <span className="font-mono text-[11px] tabular-nums">{uids.length}</span>
                              </button>
                            );
                          })}
                        </div>

                        {isOwn && (
                          <div className="flex items-center gap-1 text-[11px] text-slate-400 ml-auto">
                            {msg._pendingWrite ? (
                              <Check className="w-3.5 h-3.5 text-amber-500" />
                            ) : msg.deliveryStatus === 'read' ? (
                              <CheckCheck className="w-3.5 h-3.5 text-[#4f46e5] dark:text-[#818cf8]" />
                            ) : (
                              <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                            )}
                            <span>{msg._pendingWrite ? 'Saved locally' : msg.deliveryStatus}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Typing Indicator & Message Composer */}
        {activeGroup && isMember && (
          <div className="bg-white dark:bg-[#111827] border-t border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3 shrink-0 mb-16 md:mb-0">
            {typingNames.length > 0 && (
              <div className="text-xs text-[#4f46e5] dark:text-[#a5b4fc] mb-1.5 font-medium">
                {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing...
              </div>
            )}

            {replyTarget && (
              <div className="flex items-center justify-between gap-2 mb-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 text-xs text-slate-600 dark:text-slate-300">
                <span className="truncate">
                  Replying to <strong>{replyTarget.senderName}</strong>: {replyTarget.content}
                </span>
                <button
                  type="button"
                  onClick={() => setReplyTarget(null)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <form onSubmit={handleSendMessage} className="flex items-center gap-2.5">
              <input
                type="text"
                value={composerText}
                maxLength={SCHEMA_LIMITS.messageContentMax}
                onChange={(e) => handleComposerChange(e.target.value)}
                placeholder={
                  activeGroup.type === 'direct'
                    ? `Send encrypted direct message (${activeGroup.name})...`
                    : `Message ${activeGroup.code} (persists offline automatically)...`
                }
                className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm text-[#171b26] dark:text-[#eef0ff] focus:outline-none focus:border-[#4f46e5] focus:ring-2 focus:ring-[#4f46e5]/15"
              />
              <button
                type="submit"
                disabled={!composerText.trim()}
                className="min-h-[44px] px-4 sm:px-5 rounded-xl bg-[#4f46e5] hover:bg-[#4338ca] disabled:opacity-40 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors cursor-pointer shrink-0"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">Send</span>
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Right-hand Security, Roster & Group Permissions Inspector */}
      {inspectorOpen && activeGroup && (
        <aside className="fixed inset-y-0 right-0 z-40 w-[320px] xl:static bg-white dark:bg-[#111827] border-l border-slate-200 dark:border-slate-800 flex flex-col overflow-y-auto shrink-0 shadow-lg xl:shadow-none">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-bold font-display">Channel Security & Admin</h3>
            </div>
            <button
              type="button"
              onClick={() => setInspectorOpen(false)}
              className="xl:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-6">
            {/* Group Details & Privacy Controls */}
            {canManageGroup && activeGroup.type !== 'direct' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Group Details & Permissions
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingGroup((v) => !v)}
                    className="inline-flex items-center gap-1 text-xs text-[#3525cd] dark:text-[#a5b4fc] hover:underline cursor-pointer"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{editingGroup ? 'Close' : 'Edit'}</span>
                  </button>
                </div>

                {editingGroup ? (
                  <form
                    onSubmit={handleSaveGroupDetails}
                    className="space-y-2.5 rounded-xl bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 p-3"
                  >
                    <input
                      type="text"
                      required
                      maxLength={SCHEMA_LIMITS.groupNameMax}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full min-h-[36px] px-2.5 rounded-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 text-xs"
                    />
                    <textarea
                      rows={2}
                      maxLength={SCHEMA_LIMITS.groupDescMax}
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full p-2.5 rounded-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 text-xs"
                    />
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editPrivate}
                        onChange={(e) => setEditPrivate(e.target.checked)}
                        className="w-3.5 h-3.5 accent-[#4f46e5]"
                      />
                      <span>Private (members only)</span>
                    </label>
                    <button
                      type="submit"
                      disabled={savingGroupEdit}
                      className="w-full min-h-[34px] rounded-lg bg-[#4f46e5] hover:bg-[#4338ca] text-white text-xs font-medium cursor-pointer"
                    >
                      {savingGroupEdit ? 'Saving...' : 'Save Group Settings'}
                    </button>
                  </form>
                ) : (
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {activeGroup.description || 'No description set.'}
                  </p>
                )}
              </div>
            )}

            {/* MLS Protocol Parameters */}
            <div>
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                MLS Cryptographic State
              </div>
              <div className="rounded-xl bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Protocol Epoch</span>
                  <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    Epoch {activeGroup.mlsEpoch}
                  </span>
                </div>
                <div className="text-xs">
                  <span className="text-slate-500 block mb-1">Key Digest</span>
                  <code className="block font-mono text-[11px] bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded px-2 py-1.5 break-all">
                    {activeGroup.keyFingerprint}
                  </code>
                </div>
                {canManageGroup && (
                  <button
                    type="button"
                    onClick={handleRotateEpoch}
                    className="w-full mt-2 min-h-[36px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    Rotate MLS Epoch
                  </button>
                )}
                {epochMessage && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{epochMessage}</p>
                )}
              </div>
            </div>

            {/* Active Roster, Presence, Admin Promotion & Removal */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Channel Roster
                </span>
                <span className="text-xs text-slate-400 tabular-nums">{members.length}</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {members.map((m) => {
                  const isLive = onlineUids.has(m.uid);
                  const peerUser = directoryUsers.find((u) => u.uid === m.uid);
                  const canEditMember = canManageGroup && m.groupRole !== 'owner' && m.uid !== currentProfile?.uid;

                  return (
                    <div key={m.uid} className="px-3 py-2.5 text-xs bg-white dark:bg-[#111827] space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{m.displayName}</div>
                          <div className="text-[11px] text-slate-400 capitalize">{m.groupRole}</div>
                        </div>
                        <span
                          className={`text-[11px] font-medium shrink-0 ${
                            isLive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                          }`}
                        >
                          {isLive ? 'Online' : 'Offline'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        {peerUser && m.uid !== currentProfile?.uid && activeGroup.type !== 'direct' && (
                          <button
                            type="button"
                            onClick={() => handleStartDirectMessage(peerUser)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <MessageCircle className="w-3 h-3 text-[#4f46e5] dark:text-[#a5b4fc]" />
                            <span>DM</span>
                          </button>
                        )}
                        {canEditMember && activeGroup.type !== 'direct' && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleToggleMemberAdmin(m)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Shield className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                              <span>{m.groupRole === 'admin' ? 'Demote' : 'Make Admin'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(m)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 text-[11px] hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                            >
                              <UserMinus className="w-3 h-3" />
                              <span>Remove</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Invite or Direct Add Member */}
            {isMember && activeGroup.type !== 'direct' && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Invite or Add Scholar</span>
                </div>
                <form onSubmit={handleInviteMember} className="space-y-2">
                  <select
                    value={inviteUserId}
                    onChange={(e) => setInviteUserId(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    <option value="">Select directory member...</option>
                    {directoryUsers
                      .filter((u) => !members.some((m) => m.uid === u.uid))
                      .map((u) => (
                        <option key={u.uid} value={u.uid}>
                          {u.displayName} ({u.department})
                        </option>
                      ))}
                  </select>
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="submit"
                      disabled={!inviteUserId}
                      className="w-full min-h-[38px] rounded-lg bg-[#4f46e5] hover:bg-[#4338ca] disabled:opacity-40 text-white text-xs font-medium cursor-pointer"
                    >
                      Send Channel Invitation
                    </button>
                    {canManageGroup && (
                      <button
                        type="button"
                        disabled={!inviteUserId}
                        onClick={handleDirectAddMember}
                        className="w-full min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B0F19] hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 text-xs font-medium cursor-pointer"
                      >
                        Add Directly as Member
                      </button>
                    )}
                  </div>
                  {inviteStatus && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">{inviteStatus}</p>
                  )}
                </form>
              </div>
            )}

            {/* Quick Directory Switch */}
            <div>
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                All Active Rooms
              </div>
              <div className="space-y-1">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => onSelectGroup(g.id)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
                  >
                    <span className="truncate font-medium">{g.code}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                ))}
              </div>
            </div>

            {canManageGroup && (
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                  Room Administration
                </div>
                <button
                  type="button"
                  onClick={() => onRequestDeleteGroup(activeGroup)}
                  className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/60 text-red-700 dark:text-red-400 text-xs font-medium transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Room {activeGroup.code}</span>
                </button>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Start 1-to-1 Direct Message Modal */}
      {startDmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-lg font-bold font-display">Start Direct Message</h2>
              </div>
              <button
                type="button"
                onClick={() => onSetStartDmOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 px-3 min-h-[40px] rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 mb-3">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                value={dmSearch}
                onChange={(e) => setDmSearch(e.target.value)}
                placeholder="Search students or faculty by name or dept..."
                className="bg-transparent text-xs outline-none w-full"
              />
            </div>

            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
              {dmCandidates.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No other campus directory members found yet. When another student or faculty member signs in, they will appear here.
                </div>
              ) : (
                dmCandidates.map((peer) => {
                  const isLive = onlineUids.has(peer.uid);
                  return (
                    <button
                      key={peer.uid}
                      type="button"
                      disabled={startingDmUid === peer.uid}
                      onClick={() => handleStartDirectMessage(peer)}
                      className="w-full px-3.5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-left cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate text-[#171b26] dark:text-[#eef0ff]">
                          {peer.displayName}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate capitalize">
                          {peer.role.replace('_', ' ')} · {peer.department}
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-medium shrink-0 ${
                          isLive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                        }`}
                      >
                        {startingDmUid === peer.uid ? 'Opening...' : isLive ? 'Online' : 'Offline'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Report Message Modal */}
      {reportTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Flag className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h2 className="text-base font-bold font-display">Report Message for Moderation</h2>
              </div>
              <button
                type="button"
                onClick={() => setReportTarget(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 p-3 text-xs text-slate-600 dark:text-slate-300 mb-4 line-clamp-3">
              <strong>{reportTarget.senderName}:</strong> {reportTarget.content}
            </div>

            <form onSubmit={handleSubmitReport} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Violation Category</label>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value as ModerationReason)}
                  className="w-full min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                >
                  <option value="inappropriate">Inappropriate Content</option>
                  <option value="harassment">Harassment or Abuse</option>
                  <option value="spam">Spam / Off-Topic Flood</option>
                  <option value="academic_integrity">Academic Integrity Violation</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Additional Context (Optional)</label>
                <textarea
                  rows={2}
                  maxLength={SCHEMA_LIMITS.reportDetailsMax}
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder="Provide context for the platform moderator..."
                  className="w-full p-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReportTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReport}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium cursor-pointer"
                >
                  {submittingReport ? 'Submitting...' : 'Submit Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create New Channel Modal */}
      {createGroupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-[#4f46e5]" />
                <h2 className="text-lg font-bold font-display">Create Academic Channel</h2>
              </div>
              <button
                type="button"
                onClick={() => onSetCreateGroupOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold mb-1">Channel Code</label>
                <input
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.groupCodeMax}
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="e.g. AI-604"
                  className="w-full min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Channel Name</label>
                <input
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.groupNameMax}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Autonomous Systems Seminar"
                  className="w-full min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Category</label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as GroupType)}
                    className="w-full min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    <option value="subject">Subject</option>
                    <option value="project">Research Project</option>
                    <option value="activity">Student Activity</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1">3D Campus Wing</label>
                  <select
                    value={newBuilding}
                    onChange={(e) => setNewBuilding(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                  >
                    {CAMPUS_BUILDINGS.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.shortCode}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Description</label>
                <textarea
                  rows={2}
                  maxLength={SCHEMA_LIMITS.groupDescMax}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Purpose and syllabus topics..."
                  className="w-full p-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>

              <label className="flex items-center gap-2.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={newPrivate}
                  onChange={(e) => setNewPrivate(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#4f46e5]"
                />
                <span>Private invite-only channel (Zero-Trust membership gate)</span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => onSetCreateGroupOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingGroup}
                  className="px-4 py-2 rounded-lg bg-[#4f46e5] hover:bg-[#4338ca] text-white text-sm font-medium cursor-pointer"
                >
                  {creatingGroup ? 'Creating...' : 'Create Channel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
