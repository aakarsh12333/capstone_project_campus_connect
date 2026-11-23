import {
  BarChart3,
  BookOpen,
  Box,
  Hash,
  Lock,
  LogOut,
  MessageCircle,
  MessageSquare,
  Moon,
  Plus,
  ShieldAlert,
  Sun,
  Trash2,
  UserCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { CampusGroup, GroupMemberRole, PrimaryPage, UserPublicProfile } from '../types/campus';

interface SidebarNavProps {
  activePage: PrimaryPage;
  onSelectPage: (page: PrimaryPage) => void;
  groups: CampusGroup[];
  activeGroupId: string;
  activeMemberRole?: GroupMemberRole | null;
  unreadCounts: Record<string, number>;
  onSelectGroup: (groupId: string) => void;
  onOpenCreateGroup: () => void;
  onOpenStartDirectMessage: () => void;
  onRequestDeleteGroup: (group: CampusGroup) => void;
  profile: UserPublicProfile | null;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  isOnline: boolean;
  socketConnected: boolean;
  pendingInvitationsCount: number;
  openReportsCount: number;
  onSignOut: () => void;
  mobileChannelDrawerOpen: boolean;
  onToggleMobileChannelDrawer: (open: boolean) => void;
}

export function SidebarNav({
  activePage,
  onSelectPage,
  groups,
  activeGroupId,
  activeMemberRole,
  unreadCounts,
  onSelectGroup,
  onOpenCreateGroup,
  onOpenStartDirectMessage,
  onRequestDeleteGroup,
  profile,
  darkMode,
  onToggleDarkMode,
  isOnline,
  socketConnected,
  pendingInvitationsCount,
  openReportsCount,
  onSignOut,
  mobileChannelDrawerOpen,
  onToggleMobileChannelDrawer,
}: SidebarNavProps) {
  const showGovernanceTab =
    profile?.role === 'platform_admin' || profile?.role === 'faculty' || openReportsCount > 0;

  const navItems: Array<{ id: PrimaryPage; label: string; shortLabel: string; icon: typeof MessageSquare }> = [
    { id: 'messages', label: 'Channels & DMs', shortLabel: 'Chat', icon: MessageSquare },
    { id: 'resources', label: 'Resources', shortLabel: 'Files', icon: BookOpen },
    { id: 'campus3d', label: '3D Campus', shortLabel: '3D', icon: Box },
    { id: 'analytics', label: 'Analytics', shortLabel: 'Metrics', icon: BarChart3 },
    ...(showGovernanceTab
      ? [{ id: 'moderation' as PrimaryPage, label: 'Moderation & Admin', shortLabel: 'Admin', icon: ShieldAlert }]
      : []),
    { id: 'profile', label: 'Profile & Sync', shortLabel: 'Profile', icon: UserCheck },
  ];

  const academicChannels = groups.filter((g) => g.type !== 'direct');
  const directThreads = groups.filter((g) => g.type === 'direct');
  const totalUnread = Object.values(unreadCounts).reduce((sum, n) => sum + n, 0);

  const canDeleteGroup = (grp: CampusGroup) =>
    Boolean(
      profile &&
        (grp.creatorId === profile.uid ||
          profile.role === 'platform_admin' ||
          (grp.id === activeGroupId &&
            (activeMemberRole === 'owner' || activeMemberRole === 'admin'))),
    );

  const renderRoomRow = (grp: CampusGroup) => {
    const selected = grp.id === activeGroupId;
    const deletable = canDeleteGroup(grp);
    const unread = unreadCounts[grp.id] || 0;
    const isDirect = grp.type === 'direct';

    return (
      <div
        key={grp.id}
        className={`group flex items-center gap-1 rounded-xl transition-colors ${
          selected
            ? 'bg-white dark:bg-[#1e263d] text-[#171b26] dark:text-white shadow-sm border border-slate-200/80 dark:border-slate-700'
            : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800/60'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            onSelectGroup(grp.id);
            onToggleMobileChannelDrawer(false);
          }}
          className="flex-1 min-w-0 text-left px-3 py-2 cursor-pointer"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {isDirect ? (
                <MessageCircle className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : grp.isPrivate ? (
                <Lock className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <Hash className="w-3.5 h-3.5 text-[#4f46e5] dark:text-[#818cf8] shrink-0" />
              )}
              <span className="text-xs font-bold font-mono tracking-tight truncate">
                {grp.code}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {unread > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#4f46e5] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
              <span className="text-[11px] text-slate-400 tabular-nums">
                E{grp.mlsEpoch}
              </span>
            </div>
          </div>
          <div className="text-xs font-medium truncate mt-0.5 pl-5.5">
            {grp.name}
          </div>
        </button>

        {deletable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDeleteGroup(grp);
            }}
            title={`Delete room ${grp.code}`}
            aria-label={`Delete room ${grp.code}`}
            className="mr-1.5 min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors cursor-pointer shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Desktop Left Icon Rail (72px) */}
      <aside className="hidden md:flex flex-col items-center justify-between w-[72px] shrink-0 bg-[#0B0F19] text-slate-300 border-r border-slate-800 py-4 z-30">
        <div className="flex flex-col items-center gap-3 w-full px-2">
          <button
            type="button"
            onClick={() => onSelectPage('messages')}
            title="Campus Connect"
            className="w-11 h-11 rounded-xl bg-[#4f46e5] text-white font-display font-extrabold text-base flex items-center justify-center shadow-sm cursor-pointer"
          >
            CC
          </button>

          <div className="w-8 h-px bg-slate-800 my-1" />

          <nav className="flex flex-col items-center gap-1.5 w-full" aria-label="Primary navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              const badgeCount =
                item.id === 'messages'
                  ? pendingInvitationsCount + totalUnread
                  : item.id === 'moderation'
                    ? openReportsCount
                    : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectPage(item.id)}
                  title={item.label}
                  className={`relative w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#4f46e5] text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium leading-none">{item.shortLabel}</span>
                  {badgeCount > 0 && (
                    <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-[#0B0F19] text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col items-center gap-2 px-2">
          <div
            title={isOnline ? (socketConnected ? 'Authenticated Socket.IO Live' : 'Cloud Connected') : 'Offline Cache Mode'}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-400"
          >
            {isOnline ? (
              <Wifi className="w-4 h-4 text-emerald-400" />
            ) : (
              <WifiOff className="w-4 h-4 text-amber-400" />
            )}
          </div>

          <button
            type="button"
            onClick={onToggleDarkMode}
            title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onSelectPage('profile')}
            title={profile?.displayName || 'Profile'}
            className="w-10 h-10 rounded-full overflow-hidden border border-slate-700 bg-slate-800 text-xs font-bold text-white flex items-center justify-center cursor-pointer"
          >
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.displayName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <span>{(profile?.displayName || 'CS').slice(0, 2).toUpperCase()}</span>
            )}
          </button>
        </div>
      </aside>

      {/* Expandable 268px Channel & DM Directory Panel */}
      {activePage === 'messages' && (
        <aside
          className={`${
            mobileChannelDrawerOpen ? 'fixed inset-y-0 left-0 z-50 flex' : 'hidden lg:flex'
          } flex-col w-[268px] shrink-0 bg-[#f2f3ff] dark:bg-[#111827] border-r border-slate-200 dark:border-slate-800`}
        >
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-200/80 dark:border-slate-800">
            <div>
              <h2 className="text-sm font-bold font-display text-[#171b26] dark:text-[#eef0ff]">
                Academic Channels
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {academicChannels.length} active rooms
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenCreateGroup}
              title="Create academic channel"
              className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg bg-[#4f46e5] hover:bg-[#4338ca] text-white transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 space-y-4">
            <div className="space-y-1">
              {academicChannels.length === 0 ? (
                <div className="px-3 py-5 text-center">
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2.5">
                    No active channels yet.
                  </p>
                  <button
                    type="button"
                    onClick={onOpenCreateGroup}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4f46e5] hover:bg-[#4338ca] text-white text-xs font-medium cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Room</span>
                  </button>
                </div>
              ) : (
                academicChannels.map(renderRoomRow)
              )}
            </div>

            {/* 1-to-1 Direct Messages Section */}
            <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center justify-between px-1.5 mb-2">
                <div>
                  <h3 className="text-xs font-bold font-display text-[#171b26] dark:text-[#eef0ff]">
                    Direct Messages
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {directThreads.length} 1-to-1 threads
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenStartDirectMessage}
                  title="Start 1-to-1 Direct Message"
                  className="min-h-[30px] min-w-[30px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B0F19] hover:border-[#4f46e5] text-[#4f46e5] dark:text-[#a5b4fc] transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {directThreads.length === 0 ? (
                <button
                  type="button"
                  onClick={onOpenStartDirectMessage}
                  className="w-full px-3 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 hover:border-[#4f46e5] hover:text-[#4f46e5] dark:hover:text-[#a5b4fc] transition-colors cursor-pointer text-left"
                >
                  + Message a student or faculty member
                </button>
              ) : (
                <div className="space-y-1">{directThreads.map(renderRoomRow)}</div>
              )}
            </div>
          </div>

          <div className="p-3 border-t border-slate-200/80 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center justify-between">
              <span>Sync state</span>
              <span className={isOnline ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-amber-600 dark:text-amber-400 font-medium'}>
                {isOnline ? 'Live Cloud' : 'Offline Cache'}
              </span>
            </div>
          </div>
        </aside>
      )}

      {/* Mobile Drawer Backdrop */}
      {mobileChannelDrawerOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => onToggleMobileChannelDrawer(false)}
        />
      )}

      {/* Mobile Fixed Bottom Navigation Bar (<768px, 64px height, >=44px touch targets) */}
      <nav
        aria-label="Mobile navigation"
        className={`md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 dark:bg-[#0B0F19]/95 border-t border-slate-200 dark:border-slate-800 grid ${
          navItems.length === 6 ? 'grid-cols-6' : 'grid-cols-5'
        } items-center px-1`}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectPage(item.id)}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors cursor-pointer ${
                isActive
                  ? 'text-[#3525cd] dark:text-[#a5b4fc]'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-none whitespace-nowrap">
                {item.shortLabel}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
