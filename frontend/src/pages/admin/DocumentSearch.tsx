import React, { useState, useCallback } from 'react';
import api from '../../services/api';

interface SearchStats {
  lightragConnected: boolean;
  companyDocuments: number;
  indexedDocuments: number;
  pendingIndexing: number;
}

export default function DocumentSearch() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'hybrid' | 'local' | 'global' | 'naive'>('hybrid');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<SearchStats | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexResult, setReindexResult] = useState<string>('');

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/document-search/stats');
      setStats(res.data);
    } catch { /* ignore */ }
  }, []);

  React.useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    setAnswer('');

    try {
      const res = await api.post('/document-search/query', {
        query: query.trim(),
        mode,
        topK: 10,
      });
      setAnswer(res.data.answer || 'No relevant information found.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Search failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleReindex = async () => {
    if (!confirm('Re-index all documents? This will send all unindexed files to LightRAG.')) return;
    setReindexing(true);
    setReindexResult('');
    try {
      const res = await api.post('/document-search/reindex');
      const d = res.data;
      setReindexResult(`Queued ${d.queued} files (${d.companyDocuments} company docs + ${d.uploadFiles} upload files)${d.errors?.length ? `. Errors: ${d.errors.length}` : ''}`);
      fetchStats();
    } catch (err: unknown) {
      setReindexResult('Reindex failed');
    } finally {
      setReindexing(false);
    }
  };

  const healthCheck = async () => {
    try {
      const res = await api.get('/document-search/health');
      alert(res.data.connected ? 'LightRAG is connected and healthy.' : `LightRAG is not reachable. ${res.data.error || ''}`);
    } catch {
      alert('Failed to check LightRAG health.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Document Search</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">AI-Powered Search Across All Documents (LightRAG)</span>
          </div>
          <div className="flex gap-2">
            <button onClick={healthCheck} className="px-3 py-1 bg-white/10 text-white text-[11px] font-medium hover:bg-white/20 border border-white/20">
              Health Check
            </button>
            <button onClick={handleReindex} disabled={reindexing}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
              {reindexing ? 'Reindexing...' : 'Reindex All'}
            </button>
          </div>
        </div>

        {/* Stats Strip */}
        {stats && (
          <div className="grid grid-cols-4 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">LightRAG</div>
              <div className={`text-sm font-bold mt-1 ${stats.lightragConnected ? 'text-green-600' : 'text-red-600'}`}>
                {stats.lightragConnected ? 'CONNECTED' : 'OFFLINE'}
              </div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Company Docs</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.companyDocuments}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-teal-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Indexed</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.indexedDocuments}</div>
            </div>
            <div className="bg-white px-4 py-3 border-l-4 border-l-amber-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pending</div>
              <div className="text-xl font-bold text-amber-600 mt-1 font-mono tabular-nums">{stats.pendingIndexing}</div>
            </div>
          </div>
        )}

        {reindexResult && (
          <div className="bg-blue-50 border-x border-b border-blue-300 px-4 py-2 -mx-3 md:-mx-6 text-xs text-blue-700">
            {reindexResult}
          </div>
        )}

        {/* Search Box */}
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white p-6">
          <form onSubmit={handleSearch} className="space-y-3">
            <div className="flex gap-2">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Ask a question about your documents... e.g. 'When does our EC expire?' or 'Find invoices from ABC Chemicals'"
                className="border border-slate-300 px-4 py-2.5 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                autoFocus
              />
              <button type="submit" disabled={loading || !query.trim()}
                className="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>
            <div className="flex gap-2 items-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Mode:</span>
              {(['hybrid', 'local', 'global', 'naive'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`text-[11px] px-2.5 py-1 border ${mode === m ? 'border-blue-600 bg-blue-50 text-blue-700 font-bold' : 'border-slate-300 text-slate-500 hover:bg-slate-50'}`}>
                  {m === 'hybrid' ? 'Hybrid (Best)' : m === 'local' ? 'Entity Focus' : m === 'global' ? 'Relationship Focus' : 'Simple Vector'}
                </button>
              ))}
            </div>
          </form>
        </div>

        {/* Answer */}
        {error && (
          <div className="border-x border-b border-red-300 -mx-3 md:-mx-6 bg-red-50 p-4">
            <div className="text-[10px] font-bold text-red-600 uppercase tracking-widest mb-1">Error</div>
            <div className="text-sm text-red-700">{error}</div>
          </div>
        )}

        {answer && (
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
            <div className="bg-slate-100 px-4 py-2 border-b border-slate-300">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">AI Answer</span>
              <span className="text-[10px] text-slate-400 ml-2">Mode: {mode}</span>
            </div>
            <div className="p-4">
              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{answer}</div>
            </div>
          </div>
        )}

        {/* Info Card */}
        {!answer && !error && !loading && (
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white p-6">
            <div className="text-center text-slate-400 space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-widest">How It Works</div>
              <div className="text-xs max-w-lg mx-auto space-y-1">
                <p>LightRAG builds a knowledge graph from all your documents — vendor invoices, compliance certificates, contracts, e-way bills, and more.</p>
                <p>Ask natural language questions and get AI-powered answers with context from your actual documents.</p>
              </div>
              <div className="flex justify-center gap-4 mt-4">
                <div className="text-left">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Try asking:</div>
                  <ul className="text-xs text-slate-500 space-y-0.5">
                    <li>"When does our Environmental Clearance expire?"</li>
                    <li>"What are the terms with vendor XYZ?"</li>
                    <li>"Find invoices related to sulfuric acid"</li>
                    <li>"What are our pollution control obligations?"</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
