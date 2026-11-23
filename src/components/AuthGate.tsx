import { signInWithPopup } from 'firebase/auth';
import { ArrowRight, Lock, Moon, ShieldCheck, Sun, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { auth, googleProvider } from '../firebase';

interface AuthGateProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export function AuthGate({ darkMode, onToggleDarkMode }: AuthGateProps) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to complete authentication.';
      setErrorMsg(message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#faf8ff] dark:bg-[#0B0F19] text-[#171b26] dark:text-[#eef0ff] flex flex-col">
      {/* 3-Zone Top Bar */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-200/80 dark:border-slate-800/80 max-w-7xl w-full mx-auto">
        <span className="text-lg font-bold tracking-tight font-display whitespace-nowrap shrink-0">
          Campus Connect
        </span>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
          <span className="whitespace-nowrap shrink-0">Encrypted Channels</span>
          <span className="whitespace-nowrap shrink-0">Resource Vault</span>
          <span className="whitespace-nowrap shrink-0">3D Topology</span>
          <span className="whitespace-nowrap shrink-0">Offline Persistence</span>
        </nav>

        <button
          type="button"
          onClick={onToggleDarkMode}
          aria-label="Toggle color theme"
          className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      {/* Main Split Hero */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8 lg:py-12">
        <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left Sign-In & Overview Panel */}
          <div className="lg:col-span-6 flex flex-col justify-center bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-10 shadow-sm">
            <div className="text-xs font-medium text-[#3525cd] dark:text-[#a5b4fc] tracking-wide mb-3">
              Academic Zero-Trust Collaboration
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold font-display tracking-tight text-balance mb-4">
              Unified campus messaging, resource vaults, and offline-first sync.
            </h1>

            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed mb-8 max-w-xl">
              Built for research labs, faculty syndicates, and student cohorts. Communicate in real time via Socket.IO and Firestore with automatic IndexedDB persistence when connectivity drops.
            </p>

            <div className="space-y-3 mb-8 border-t border-slate-100 dark:border-slate-800 pt-6">
              <div className="flex items-start gap-3">
                <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <span className="font-semibold">Zero-Trust Firebase Auth & Hardened Rules</span>
                  <span className="text-slate-500 dark:text-slate-400"> · Role-scoped channel and resource access.</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <WifiOff className="w-4 h-4 text-[#4f46e5] dark:text-[#818cf8] mt-0.5 shrink-0" />
                <div className="text-sm">
                  <span className="font-semibold">Instant Local State Persistence</span>
                  <span className="text-slate-500 dark:text-slate-400"> · Edit profiles and queue messages offline with zero latency.</span>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <span className="font-semibold">Live Engagement Analytics & 3D Campus</span>
                  <span className="text-slate-500 dark:text-slate-400"> · Real-time metrics across channels and departments.</span>
                </div>
              </div>
            </div>

            {errorMsg && (
              <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-4 py-3 text-xs text-red-700 dark:text-red-300">
                {errorMsg}
              </div>
            )}

            <button
              type="button"
              disabled={loading}
              onClick={handleGoogleLogin}
              className="w-full min-h-[48px] inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl bg-[#4f46e5] hover:bg-[#4338ca] disabled:opacity-60 text-white font-semibold text-sm transition-colors cursor-pointer"
            >
              <span>{loading ? 'Verifying University Session...' : 'Sign in with Google Institutional Auth'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              Your profile, channels, and offline cache synchronize automatically upon authentication.
            </p>
          </div>

          {/* Right Architectural Campus Visual */}
          <div className="lg:col-span-6 relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#0B0F19] min-h-[300px] lg:min-h-[520px]">
            <img
              src="/src/assets/images/campus_hub_architecture_1794973852843.jpg"
              alt="Campus Connect University Research Hub"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F19]/90 via-[#0B0F19]/30 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 text-white">
              <div className="font-mono text-xs text-emerald-300 mb-2">
                MLS-256 · IndexedDB Persistent Cache Ready
              </div>
              <h2 className="text-xl font-bold font-display mb-1">
                Central Academic Observatory & Relay Mesh
              </h2>
              <p className="text-sm text-slate-300">
                Connect across Computer Science, Cryptography, and Mathematical Sciences in real time.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
