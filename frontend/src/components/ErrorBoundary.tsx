import React from 'react';

interface State { hasError: boolean; error?: Error }

function isChunkLoadError(error: Error): boolean {
  const msg = error.message || '';
  return (
    msg.includes('Loading chunk') ||
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    error.name === 'ChunkLoadError'
  );
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    // Auto-reload on chunk load errors (happens after deploy when old JS files are gone)
    if (isChunkLoadError(error)) {
      const lastReload = sessionStorage.getItem('chunk-reload');
      const now = Date.now();
      // Only auto-reload once per 30 seconds to avoid infinite loops
      if (!lastReload || now - parseInt(lastReload) > 30000) {
        sessionStorage.setItem('chunk-reload', String(now));
        window.location.reload();
        return;
      }
    }
  }
  render() {
    if (this.state.hasError) {
      const isChunk = this.state.error && isChunkLoadError(this.state.error);
      return (
        <div className="flex items-center justify-center min-h-screen bg-slate-50">
          <div className="text-center p-8 bg-white shadow-2xl max-w-md">
            <div className="text-4xl mb-4">{isChunk ? '🔄' : '⚠'}</div>
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest mb-2">
              {isChunk ? 'App Updated' : 'Something went wrong'}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              {isChunk
                ? 'A new version has been deployed. Please reload to get the latest version.'
                : 'An unexpected error occurred. Please try refreshing the page.'}
            </p>
            <button
              onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
              className="px-4 py-2 bg-blue-600 text-white text-xs font-medium hover:bg-blue-700"
            >
              {isChunk ? 'RELOAD APP' : 'REFRESH PAGE'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
