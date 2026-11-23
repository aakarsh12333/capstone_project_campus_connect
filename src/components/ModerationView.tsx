import {
  CheckCircle2,
  Flag,
  Megaphone,
  ShieldAlert,
  Trash2,
  UserCog,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import {
  recordEngagementMetric,
  resolveModerationReport,
  updateUserDirectoryRole,
} from '../services/campusService';
import type {
  ModerationReport,
  UserPublicProfile,
  UserRole,
} from '../types/campus';

interface ModerationViewProps {
  currentProfile: UserPublicProfile | null;
  reports: ModerationReport[];
  directoryUsers: UserPublicProfile[];
  onEmitAnnouncement: (payload: {
    title: string;
    body: string;
    authorName: string;
    authorRole: string;
  }) => void;
}

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'student', label: 'Student' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'group_admin', label: 'Group Admin' },
  { value: 'platform_admin', label: 'Platform Admin' },
];

export function ModerationView({
  currentProfile,
  reports,
  directoryUsers,
  onEmitAnnouncement,
}: ModerationViewProps) {
  const [reportFilter, setReportFilter] = useState<'open' | 'all'>('open');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [roleFeedback, setRoleFeedback] = useState<string | null>(null);
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annSent, setAnnSent] = useState<string | null>(null);

  const isAdmin = currentProfile?.role === 'platform_admin';
  const canAnnounce = currentProfile?.role === 'platform_admin' || currentProfile?.role === 'faculty';

  const visibleReports =
    reportFilter === 'open' ? reports.filter((r) => r.status === 'open') : reports;

  const handleResolveReport = async (
    report: ModerationReport,
    status: 'resolved' | 'dismissed',
    removeMessage: boolean,
  ) => {
    if (!currentProfile || !isAdmin) return;
    setBusyId(report.id);
    try {
      await resolveModerationReport({
        reportId: report.id,
        status,
        resolvedByUid: currentProfile.uid,
        deleteMessage: removeMessage
          ? { groupId: report.groupId, messageId: report.messageId }
          : undefined,
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleRoleChange = async (user: UserPublicProfile, nextRole: UserRole) => {
    if (!isAdmin || user.role === nextRole) return;
    setBusyId(user.uid);
    try {
      await updateUserDirectoryRole({ targetUid: user.uid, role: nextRole });
      setRoleFeedback(`Updated ${user.displayName} to ${nextRole.replace('_', ' ')}.`);
      window.setTimeout(() => setRoleFeedback(null), 3000);
    } finally {
      setBusyId(null);
    }
  };

  const handleBroadcastAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProfile || !canAnnounce || !annTitle.trim() || !annBody.trim()) return;

    onEmitAnnouncement({
      title: annTitle.trim(),
      body: annBody.trim(),
      authorName: currentProfile.displayName,
      authorRole: currentProfile.role,
    });

    await recordEngagementMetric({
      userId: currentProfile.uid,
      userRole: currentProfile.role,
      eventType: 'announcement_posted',
      department: currentProfile.department,
      latencyMs: 8,
      wasOffline: typeof navigator !== 'undefined' && !navigator.onLine,
    });

    setAnnTitle('');
    setAnnBody('');
    setAnnSent('Campus-wide announcement broadcasted to all connected sessions.');
    window.setTimeout(() => setAnnSent(null), 3500);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] dark:bg-[#0B0F19] p-4 sm:p-8 pb-24 md:pb-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold font-display tracking-tight">
              Governance, Moderation & Announcements
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Review flagged messages, manage campus role permissions, and broadcast live announcements via Socket.IO.
            </p>
          </div>
          <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
            Role: <strong className="text-[#3525cd] dark:text-[#a5b4fc] uppercase">{currentProfile?.role || 'student'}</strong>
          </div>
        </div>

        {/* Campus-Wide Announcement Broadcaster */}
        {canAnnounce && (
          <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-3">
              <Megaphone className="w-4 h-4 text-[#4f46e5] dark:text-[#a5b4fc]" />
              <h2 className="text-sm font-bold font-display">Broadcast Campus Announcement</h2>
            </div>
            <form onSubmit={handleBroadcastAnnouncement} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={annTitle}
                  onChange={(e) => setAnnTitle(e.target.value)}
                  placeholder="Announcement headline (e.g. Lab Schedule Update)"
                  className="sm:col-span-1 min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                />
                <input
                  type="text"
                  required
                  maxLength={140}
                  value={annBody}
                  onChange={(e) => setAnnBody(e.target.value)}
                  placeholder="Message broadcasted in real time to all connected campus members..."
                  className="sm:col-span-2 min-h-[40px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  {annSent || ''}
                </span>
                <button
                  type="submit"
                  className="min-h-[40px] px-4 rounded-lg bg-[#4f46e5] hover:bg-[#4338ca] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Megaphone className="w-3.5 h-3.5" />
                  <span>Broadcast Now</span>
                </button>
              </div>
            </form>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Reported Messages Queue */}
          <section className="lg:col-span-7 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Flag className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h2 className="text-sm font-bold font-display">Reported Messages Queue</h2>
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setReportFilter('open')}
                  className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                    reportFilter === 'open'
                      ? 'bg-[#4f46e5] text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Open ({reports.filter((r) => r.status === 'open').length})
                </button>
                <button
                  type="button"
                  onClick={() => setReportFilter('all')}
                  className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                    reportFilter === 'all'
                      ? 'bg-[#4f46e5] text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  All ({reports.length})
                </button>
              </div>
            </div>

            {visibleReports.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
                <ShieldAlert className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                No {reportFilter === 'open' ? 'open' : ''} moderation reports.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleReports.map((rep) => (
                  <div key={rep.id} className="p-4 sm:p-5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[#3525cd] dark:text-[#a5b4fc]">
                          {rep.groupCode}
                        </span>
                        <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                        <span className="capitalize font-semibold text-amber-700 dark:text-amber-400">
                          {rep.reason.replace('_', ' ')}
                        </span>
                        <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                        <span className="text-slate-500 dark:text-slate-400">
                          Reported by {rep.reporterName}
                        </span>
                      </div>
                      <span
                        className={`font-mono uppercase text-[11px] font-semibold ${
                          rep.status === 'open'
                            ? 'text-amber-600 dark:text-amber-400'
                            : rep.status === 'resolved'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-400'
                        }`}
                      >
                        {rep.status}
                      </span>
                    </div>

                    <div className="rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 p-3 text-xs">
                      <div className="font-semibold text-slate-700 dark:text-slate-200 mb-1">
                        Author: {rep.reportedUserName}
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">
                        "{rep.messagePreview}"
                      </p>
                      {rep.details && (
                        <p className="mt-1.5 text-slate-500 dark:text-slate-400 italic">
                          Note: {rep.details}
                        </p>
                      )}
                    </div>

                    {isAdmin && rep.status === 'open' && (
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          disabled={busyId === rep.id}
                          onClick={() => handleResolveReport(rep, 'dismissed', false)}
                          className="min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5 text-slate-500" />
                          <span>Dismiss</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyId === rep.id}
                          onClick={() => handleResolveReport(rep, 'resolved', false)}
                          className="min-h-[34px] px-3 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Mark Resolved</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyId === rep.id}
                          onClick={() => handleResolveReport(rep, 'resolved', true)}
                          className="min-h-[34px] px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove Message & Resolve</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Platform User Role Management */}
          <section className="lg:col-span-5 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <UserCog className="w-4 h-4 text-[#4f46e5] dark:text-[#a5b4fc]" />
                <h2 className="text-sm font-bold font-display">Campus Directory & Roles</h2>
              </div>
              <span className="text-xs text-slate-400 tabular-nums">{directoryUsers.length}</span>
            </div>

            {roleFeedback && (
              <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300">
                {roleFeedback}
              </div>
            )}

            <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto max-h-[520px]">
              {directoryUsers.map((u) => (
                <div key={u.uid} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate text-[#171b26] dark:text-[#eef0ff]">
                      {u.displayName}
                      {u.uid === currentProfile?.uid && (
                        <span className="ml-1.5 text-[11px] text-slate-400 font-normal">(You)</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {u.department}
                    </div>
                  </div>

                  {isAdmin ? (
                    <select
                      aria-label={`Role for ${u.displayName}`}
                      value={u.role}
                      disabled={busyId === u.uid}
                      onChange={(e) => handleRoleChange(u, e.target.value as UserRole)}
                      className="min-h-[34px] px-2.5 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-xs font-medium shrink-0"
                    >
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-slate-500 dark:text-slate-400 capitalize shrink-0">
                      {u.role.replace('_', ' ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
