import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ShieldAlert, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected error occurred.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Campus Connect Boundary Caught:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  public render() {
    if (this.state.hasError) {
      let parsedSummary = this.state.errorMessage;
      try {
        const json = JSON.parse(this.state.errorMessage);
        if (json?.error && json?.operationType) {
          parsedSummary = `${json.operationType.toUpperCase()} on ${json.path || 'database'}: ${json.error}`;
        }
      } catch {
        // Non-JSON error message
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#faf8ff] dark:bg-[#0B0F19] p-6">
          <div className="max-w-lg w-full rounded-xl bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400 mb-3">
              <ShieldAlert className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-bold font-display">Security or Sync Interruption</h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
              Campus Connect encountered a database or permission constraint while syncing state.
            </p>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 font-mono text-xs text-slate-700 dark:text-slate-300 break-words mb-5">
              {parsedSummary}
            </div>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4f46e5] hover:bg-[#4338ca] text-white text-sm font-medium transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Restore Workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
