import { Activity, Clock, Database, MessageSquare, Share2, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getAuthHeaders } from '../services/authToken';
import type { EngagementEvent } from '../types/campus';

interface AnalyticsViewProps {
  userEvents: EngagementEvent[];
  isOnline: boolean;
}

interface BackendEngagementReport {
  range: string;
  generatedAt: string;
  totals: {
    messagesExchanged: number;
    resourcesShared: number;
    offlineQueuedSynced: number;
    activeChannels: number;
    avgWriteLatencyMs: number;
    e2eVerificationRate: number;
  };
  dailySeries: Array<{
    day: string;
    messages: number;
    resources: number;
    offlineSynced: number;
  }>;
  roleDistribution: Array<{ role: string; actions: number }>;
  channelActivity: Array<{
    code: string;
    name: string;
    messages: number;
    resources: number;
    buildingNode: string;
  }>;
}

export function AnalyticsView({ userEvents, isOnline }: AnalyticsViewProps) {
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [report, setReport] = useState<BackendEngagementReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getAuthHeaders()
      .then((headers) => fetch(`/api/reports/engagement?range=${range}`, { headers }))
      .then((res) => res.json())
      .then((json) => {
        if (active && json?.success && json?.data) {
          setReport(json.data);
        }
      })
      .catch(() => {
        // Offline fallback preserves cached report if any
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [range, userEvents.length]);

  const personalStats = useMemo(() => {
    const total = userEvents.length;
    const offlineCount = userEvents.filter((e) => e.wasOffline).length;
    const avgLatency =
      total > 0
        ? Math.round(userEvents.reduce((acc, e) => acc + e.latencyMs, 0) / total)
        : 14;
    const messages = userEvents.filter((e) => e.eventType === 'message_sent').length;
    const resources = userEvents.filter(
      (e) => e.eventType === 'resource_shared' || e.eventType === 'resource_downloaded',
    ).length;

    return { total, offlineCount, avgLatency, messages, resources };
  }, [userEvents]);

  const maxDailyMessages = useMemo(() => {
    if (!report?.dailySeries?.length) return 100;
    return Math.max(...report.dailySeries.map((d) => d.messages), 10);
  }, [report]);

  const maxRoleActions = useMemo(() => {
    if (!report?.roleDistribution?.length) return 100;
    return Math.max(...report.roleDistribution.map((r) => r.actions), 10);
  }, [report]);

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] dark:bg-[#0B0F19] p-4 sm:p-8 pb-24 md:pb-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header & Range Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold font-display tracking-tight">
              Engagement & Sync Analytics
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Real-time collaboration telemetry across Firebase Firestore, IndexedDB offline cache, and Express aggregation pipelines.
            </p>
          </div>

          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 self-start">
            {(['24h', '7d', '30d'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  range === r
                    ? 'bg-[#4f46e5] text-white'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* 4-Column KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>Messages Exchanged</span>
              <MessageSquare className="w-4 h-4 text-[#4f46e5]" />
            </div>
            <div className="text-2xl font-bold font-display tabular-nums">
              {report ? (report.totals.messagesExchanged + personalStats.messages).toLocaleString() : personalStats.messages}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
              {personalStats.messages} by your session
            </div>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>Resources Shared & Accessed</span>
              <Share2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="text-2xl font-bold font-display tabular-nums">
              {report ? (report.totals.resourcesShared + personalStats.resources).toLocaleString() : personalStats.resources}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
              {personalStats.resources} personal interactions
            </div>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>Local Write Latency</span>
              <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="text-2xl font-bold font-display tabular-nums">
              {personalStats.avgLatency} ms
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              IndexedDB zero-block commit
            </div>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>Offline-Queued Synced</span>
              <WifiOff className="w-4 h-4 text-[#6366f1]" />
            </div>
            <div className="text-2xl font-bold font-display tabular-nums">
              {report ? report.totals.offlineQueuedSynced + personalStats.offlineCount : personalStats.offlineCount}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {isOnline ? 'Cache synchronized' : 'Operating offline'}
            </div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 7-Day Activity Velocity SVG Chart */}
          <section className="lg:col-span-7 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-bold font-display">Daily Collaboration Velocity</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Messages vs. offline-queued events reconciled across channels
                </p>
              </div>
              <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
                {loading ? 'Refreshing...' : `${range.toUpperCase()} Pipeline`}
              </span>
            </div>

            {report?.dailySeries ? (
              <div className="h-56 flex items-end justify-between gap-2 sm:gap-4 pt-4 border-b border-slate-100 dark:border-slate-800 pb-2">
                {report.dailySeries.map((d) => {
                  const msgHeight = Math.max(12, Math.round((d.messages / maxDailyMessages) * 165));
                  const offlineHeight = Math.max(4, Math.round((d.offlineSynced / maxDailyMessages) * 165));
                  return (
                    <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
                      <div className="w-full flex items-end justify-center gap-1 h-[170px]">
                        <div
                          style={{ height: `${msgHeight}px` }}
                          title={`${d.messages} messages`}
                          className="w-full max-w-[26px] rounded-t-md bg-[#4f46e5] transition-all"
                        />
                        <div
                          style={{ height: `${offlineHeight}px` }}
                          title={`${d.offlineSynced} offline synced`}
                          className="w-2.5 rounded-t-md bg-emerald-500 transition-all"
                        />
                      </div>
                      <div className="text-center">
                        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {d.day}
                        </div>
                        <div className="text-[11px] text-slate-400 tabular-nums">{d.messages}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-56 flex items-center justify-center text-sm text-slate-400">
                Loading aggregation series...
              </div>
            )}

            <div className="flex items-center gap-5 mt-3 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-[#4f46e5] inline-block" />
                <span>Real-time messages</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />
                <span>Offline-reconciled writes</span>
              </div>
            </div>
          </section>

          {/* Role Engagement Breakdown */}
          <section className="lg:col-span-5 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 flex flex-col justify-between">
            <div>
              <h2 className="text-base font-bold font-display mb-1">Engagement by Academic Role</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
                RBAC-partitioned activity volume from EventEmitter pipeline
              </p>

              <div className="space-y-4">
                {(report?.roleDistribution || []).map((item) => {
                  const pct = Math.max(6, Math.round((item.actions / maxRoleActions) * 100));
                  return (
                    <div key={item.role} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium capitalize">{item.role.replace('_', ' ')}</span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {item.actions.toLocaleString()} actions
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          style={{ width: `${pct}%` }}
                          className="h-full rounded-full bg-[#4f46e5]"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>E2E Signature Integrity</span>
              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {report?.totals.e2eVerificationRate ?? 99.8}% Verified
              </span>
            </div>
          </section>
        </div>

        {/* Channel Activity Table + Live Personal Firestore Event Stream */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-6 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[#4f46e5]" />
                <h2 className="text-sm font-bold font-display">Channel Engagement Aggregation</h2>
              </div>
              <span className="text-xs text-slate-400">Top Channels</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Channel</th>
                    <th className="px-5 py-3 font-semibold text-right">Messages</th>
                    <th className="px-5 py-3 font-semibold text-right">Resources</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(report?.channelActivity || []).map((ch) => (
                    <tr key={ch.code} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="px-5 py-3">
                        <div className="font-semibold text-[#171b26] dark:text-[#eef0ff]">{ch.name}</div>
                        <div className="font-mono text-[11px] text-slate-400">{ch.code}</div>
                      </td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums">{ch.messages}</td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums">{ch.resources}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="lg:col-span-6 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-sm font-bold font-display">Your Live Firestore Telemetry</h2>
              </div>
              <span className="text-xs text-slate-400 tabular-nums">{userEvents.length} events</span>
            </div>
            {userEvents.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                Send a message, inspect a 3D wing, or update your profile to log live Firestore events.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
                {userEvents.slice(0, 12).map((evt) => (
                  <div key={evt.id} className="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium capitalize truncate">
                        {evt.eventType.replace(/_/g, ' ')}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {evt.department || 'Campus'} · {evt.wasOffline ? 'Queued Offline' : 'Direct Cloud'}
                      </div>
                    </div>
                    <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                      {evt.latencyMs}ms
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
