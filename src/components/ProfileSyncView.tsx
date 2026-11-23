import { CheckCircle2, Database, KeyRound, Moon, RefreshCw, Server, Shield, Sun, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { generateKeyFingerprint, updateUserProfilesOfflineFirst } from '../services/campusService';
import {
  SCHEMA_LIMITS,
  type ThemePreference,
  type UserPrivateInfo,
  type UserPublicProfile,
} from '../types/campus';

interface ProfileSyncViewProps {
  profile: UserPublicProfile | null;
  privateInfo: UserPrivateInfo | null;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  isOnline: boolean;
  lastSyncedAt: string;
  syncCount: number;
  socketConnected: boolean;
}

interface ArchitectureCatalog {
  project: string;
  endpoints: Array<{ method: string; path: string; description: string }>;
  socketEvents: Array<{ event: string; direction: string; purpose: string }>;
}

export function ProfileSyncView({
  profile,
  privateInfo,
  darkMode,
  onToggleDarkMode,
  isOnline,
  lastSyncedAt,
  syncCount,
  socketConnected,
}: ProfileSyncViewProps) {
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [department, setDepartment] = useState(profile?.department || 'Computer Science');
  const [bio, setBio] = useState(profile?.bio || '');
  const [statusMessage, setStatusMessage] = useState(profile?.statusMessage || '');
  const [academicId, setAcademicId] = useState(privateInfo?.academicId || '');
  const [fingerprint, setFingerprint] = useState(profile?.publicKeyFingerprint || '');
  const [offlineSyncEnabled, setOfflineSyncEnabled] = useState(privateInfo?.offlineSyncEnabled ?? true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(privateInfo?.notificationsEnabled ?? true);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ArchitectureCatalog | null>(null);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName);
      setDepartment(profile.department);
      setBio(profile.bio || '');
      setStatusMessage(profile.statusMessage || '');
      setFingerprint(profile.publicKeyFingerprint);
    }
  }, [profile]);

  useEffect(() => {
    if (privateInfo) {
      setAcademicId(privateInfo.academicId || '');
      setOfflineSyncEnabled(privateInfo.offlineSyncEnabled);
      setNotificationsEnabled(privateInfo.notificationsEnabled);
    }
  }, [privateInfo]);

  useEffect(() => {
    fetch('/api/architecture/endpoints')
      .then((res) => res.json())
      .then((json) => {
        if (json?.success) setCatalog(json);
      })
      .catch(() => {});
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;

    const themePref: ThemePreference = darkMode ? 'dark' : 'light';
    const { queuedOffline, latencyMs } = await updateUserProfilesOfflineFirst({
      uid: profile.uid,
      role: profile.role,
      displayName,
      department,
      bio,
      statusMessage,
      themePreference: themePref,
      publicKeyFingerprint: fingerprint,
      academicId,
      offlineSyncEnabled,
      notificationsEnabled,
    });

    setSaveFeedback(
      queuedOffline
        ? `Saved instantaneously to IndexedDB offline cache (${latencyMs}ms). Will sync automatically on reconnect.`
        : `Profile & private vault synchronized in ${latencyMs}ms.`,
    );
    setTimeout(() => setSaveFeedback(null), 4000);
  };

  const handleRegenerateKey = () => {
    if (!profile) return;
    setFingerprint(generateKeyFingerprint(`${profile.uid}-${Date.now()}`));
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#faf8ff] dark:bg-[#0B0F19] p-4 sm:p-8 pb-24 md:pb-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold font-display tracking-tight">
              Profile & Offline Sync Vault
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Manage your academic identity with zero-latency IndexedDB persistence and split PII isolation.
            </p>
          </div>

          <button
            type="button"
            onClick={onToggleDarkMode}
            className="min-h-[42px] px-4 rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer self-start sm:self-auto"
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-[#4f46e5]" />}
            <span>{darkMode ? 'Light Appearance' : 'Dark Appearance'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Profile Form (Zero-Latency Local Mutation) */}
          <form
            onSubmit={handleSaveProfile}
            className="lg:col-span-7 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center font-bold">
                  {profile?.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt={profile.displayName}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{(displayName || 'CS').slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div>
                  <div className="font-bold font-display text-base">{profile?.displayName || 'Scholar'}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 capitalize">
                    {profile?.role.replace('_', ' ') || 'student'} · {privateInfo?.email || 'Verified Institutional Email'}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Display Name</label>
                <input
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.displayNameMax}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Department</label>
                <input
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.departmentMax}
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Academic / University ID (Private PII)</label>
                <input
                  type="text"
                  maxLength={SCHEMA_LIMITS.academicIdMax}
                  value={academicId}
                  onChange={(e) => setAcademicId(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Presence Status</label>
                <input
                  type="text"
                  maxLength={SCHEMA_LIMITS.statusMessageMax}
                  value={statusMessage}
                  onChange={(e) => setStatusMessage(e.target.value)}
                  placeholder="e.g. In Distributed Systems Lab"
                  className="w-full min-h-[42px] px-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Research Bio</label>
              <textarea
                rows={3}
                maxLength={SCHEMA_LIMITS.bioMax}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full p-3 rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-700 text-sm"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold">MLS Identity Key Fingerprint</label>
                <button
                  type="button"
                  onClick={handleRegenerateKey}
                  className="text-xs text-[#3525cd] dark:text-[#a5b4fc] hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  Rotate Key
                </button>
              </div>
              <div className="flex items-center gap-2 px-3 min-h-[40px] rounded-lg bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 font-mono text-xs text-emerald-600 dark:text-emerald-400">
                <KeyRound className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{fingerprint}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 pt-1">
              <label className="flex items-center gap-2.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={offlineSyncEnabled}
                  onChange={(e) => setOfflineSyncEnabled(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#4f46e5]"
                />
                <span>Automatic IndexedDB offline persistence</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(e) => setNotificationsEnabled(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#4f46e5]"
                />
                <span>Real-time Socket.IO room alerts</span>
              </label>
            </div>

            {saveFeedback && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{saveFeedback}</span>
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#4f46e5] hover:bg-[#4338ca] text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                Save Profile & Sync State
              </button>
            </div>
          </form>

          {/* Offline State & Capstone Backend Architecture */}
          <div className="lg:col-span-5 space-y-6">
            <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3.5">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[#4f46e5]" />
                <h2 className="text-sm font-bold font-display">Offline Persistence & Sync Engine</h2>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                <div className="py-2.5 flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Network Connectivity</span>
                  <span className={`inline-flex items-center gap-1.5 font-semibold ${isOnline ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                    {isOnline ? 'Online' : 'Offline Mode Active'}
                  </span>
                </div>
                <div className="py-2.5 flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Local Cache Engine</span>
                  <span className="font-mono">IndexedDB Multi-Tab</span>
                </div>
                <div className="py-2.5 flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Socket.IO Presence</span>
                  <span className={socketConnected ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {socketConnected ? 'Connected' : 'Standby'}
                  </span>
                </div>
                <div className="py-2.5 flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Snapshot Sync Pulses</span>
                  <span className="font-mono tabular-nums">{syncCount}</span>
                </div>
                <div className="py-2.5 flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Last State Reconciliation</span>
                  <span className="font-mono tabular-nums">
                    {new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              </div>
            </section>

            <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-sm font-bold font-display">Capstone Backend Contracts</h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Express MVC endpoints, Node EventEmitter pipelines, and Socket.IO event flow powering Campus Connect.
              </p>

              <div className="space-y-2 pt-1">
                {(catalog?.endpoints || []).map((ep) => (
                  <div key={ep.path} className="rounded-lg bg-[#faf8ff] dark:bg-[#0B0F19] border border-slate-200 dark:border-slate-800 p-2.5 text-xs">
                    <div className="font-mono font-semibold text-[#3525cd] dark:text-[#a5b4fc]">
                      {ep.method} {ep.path}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">{ep.description}</div>
                  </div>
                ))}
              </div>

              <div className="pt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>PII isolated in usersPrivate; non-PII profiles in usersPublic.</span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
