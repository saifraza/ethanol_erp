import React, { useState } from 'react';
import api from '../../services/api';

interface GapItem {
  id: string;
  title: string;
  category: string;
  riskLevel: string;
  status: string;
  dueDate: string | null;
  authority: string | null;
}

const SUGGESTED_QUERIES = [
  'What documents are needed for factory license renewal?',
  'What are the environmental compliance requirements for a distillery?',
  'What SEBI LODR filings are due quarterly?',
  'What are the penalties for late EPF payment?',
  'What documents do I need for CTO renewal from MPPCB?',
  'What are the boiler inspection requirements?',
  'What sugar mill returns need to be filed monthly?',
  'What are the insider trading compliance requirements for listed companies?',
];

const RISK_COLORS: Record<string, string> = {
  CRITICAL: 'border-red-600 bg-red-50 text-red-700',
  HIGH: 'border-orange-600 bg-orange-50 text-orange-700',
  MEDIUM: 'border-yellow-600 bg-yellow-50 text-yellow-700',
  LOW: 'border-green-600 bg-green-50 text-green-700',
};

function fmtDate(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ComplianceAI() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [gaps, setGaps] = useState<GapItem[]>([]);
  const [gapsLoading, setGapsLoading] = useState(false);
  const [showGaps, setShowGaps] = useState(false);

  const handleAsk = async (q?: string) => {
    const query = q || question;
    if (!query.trim()) return;
    setQuestion(query);
    setLoading(true);
    setAnswer('');
    try {
      const res = await api.post('/compliance/ask', { question: query });
      setAnswer(res.data.answer || 'No answer found. Try uploading more compliance documents to the Document Vault.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('503') || msg.includes('RAG')) {
        setAnswer('RAG service is not configured. Please set LIGHTRAG_URL in environment variables.');
      } else {
        setAnswer('Failed to get answer. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGaps = async () => {
    setGapsLoading(true);
    setShowGaps(true);
    try {
      const res = await api.get('/compliance/gaps');
      setGaps(res.data.obligations || []);
    } catch (err) {
      console.error('Failed to fetch gaps:', err);
    } finally {
      setGapsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Compliance AI</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">RAG-Powered Compliance Q&A</span>
          </div>
          <button onClick={handleGaps}
            className="px-3 py-1 bg-red-600 text-white text-[11px] font-medium hover:bg-red-700">
            Gap Analysis
          </button>
        </div>

        {/* Search Bar */}
        <div className="bg-white border-x border-b border-slate-300 px-4 py-4 -mx-3 md:-mx-6">
          <div className="flex gap-2 max-w-2xl mx-auto">
            <input
              type="text"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAsk()}
              placeholder="Ask a compliance question... e.g., 'What documents are needed for factory license renewal?'"
              className="flex-1 border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
            <button onClick={() => handleAsk()} disabled={loading || !question.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Searching...' : 'Ask'}
            </button>
          </div>
        </div>

        {/* Suggested Queries */}
        {!answer && !showGaps && (
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Suggested Questions</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {SUGGESTED_QUERIES.map((q, i) => (
                <button key={i} onClick={() => handleAsk(q)}
                  className="text-left px-3 py-2 bg-white border border-slate-200 text-xs text-slate-700 hover:bg-blue-50 hover:border-blue-300 transition-colors">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Answer */}
        {answer && (
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Answer</div>
            <div className="bg-white border border-slate-200 px-4 py-3 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed max-w-3xl">
              {answer}
            </div>
            <button onClick={() => { setAnswer(''); setQuestion(''); }}
              className="mt-2 px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
              Clear
            </button>
          </div>
        )}

        {/* Gap Analysis */}
        {showGaps && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300">
            <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-700">
                Gap Analysis: {gaps.length} obligations have no supporting documents
              </span>
              <button onClick={() => setShowGaps(false)} className="text-red-400 hover:text-red-600 text-xs">&times;</button>
            </div>
            {gapsLoading ? (
              <div className="p-4 text-xs text-slate-400 text-center uppercase tracking-widest">Analyzing...</div>
            ) : gaps.length === 0 ? (
              <div className="p-4 text-xs text-green-600 text-center">All obligations have linked documents. No gaps found.</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Obligation</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Risk</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Status</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-24">Due Date</th>
                  </tr>
                </thead>
                <tbody>
                  {gaps.map((g, i) => (
                    <tr key={g.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">
                        <div>{g.title}</div>
                        {g.authority && <div className="text-[10px] text-slate-400">{g.authority}</div>}
                      </td>
                      <td className="px-3 py-1.5 text-center border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${RISK_COLORS[g.riskLevel]}`}>{g.riskLevel}</span>
                      </td>
                      <td className="px-3 py-1.5 text-center border-r border-slate-100 text-[10px] text-slate-500">{g.status}</td>
                      <td className="px-3 py-1.5 text-center text-slate-500 font-mono tabular-nums">{fmtDate(g.dueDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
