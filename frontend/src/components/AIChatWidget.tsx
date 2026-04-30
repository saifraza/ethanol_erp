import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, Send, Loader2, Bot, User, Minimize2, Settings, Download, Sparkles, Wrench, Maximize2 } from 'lucide-react';
import api from '../services/api';

interface ToolCall {
  toolId: string;
  args: Record<string, unknown>;
  result?: any;
  error?: string;
  durationMs: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  provider?: string;
  toolCalls?: ToolCall[];
  turns?: number;
}

interface AIConfigState {
  configured: boolean;
  provider?: string;
  model?: string;
  keyHint?: string;
}

const PROVIDERS = [
  { value: 'gemini', label: 'Google Gemini', placeholder: 'API key from Google AI Studio', modelDefault: 'gemini-2.5-flash' },
  { value: 'openai', label: 'OpenAI', placeholder: 'sk-... API key', modelDefault: 'gpt-4o-mini' },
  { value: 'anthropic', label: 'Anthropic Claude', placeholder: 'sk-ant-... API key', modelDefault: 'claude-sonnet-4-20250514' },
];

// ── Helpers — extract tabular datasets from a tool result for Excel export ──
function extractDatasets(toolCalls: ToolCall[] | undefined): Array<{ name: string; rows: Record<string, unknown>[]; summary?: Record<string, unknown> }> {
  if (!toolCalls || toolCalls.length === 0) return [];
  const sheets: Array<{ name: string; rows: Record<string, unknown>[]; summary?: Record<string, unknown> }> = [];
  for (const tc of toolCalls) {
    if (!tc.result || typeof tc.result !== 'object') continue;
    const r = tc.result;
    const toolShort = tc.toolId.split('.').pop() || tc.toolId;
    // Pull every array-of-objects under the result as its own sheet
    for (const [key, value] of Object.entries(r)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
        sheets.push({
          name: `${toolShort}-${key}`.slice(0, 31),
          rows: value as Record<string, unknown>[],
          summary: r.summary && typeof r.summary === 'object' ? r.summary as Record<string, unknown> : undefined,
        });
      }
    }
  }
  return sheets;
}

export default function AIChatWidget({ pageContext }: { pageContext?: string }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Hidden = user dismissed the floating button so it doesn't block content behind it.
  // Persists in localStorage; they can re-enable with Alt+Shift+A or by clearing storage.
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem('ai-widget-hidden') === '1'; } catch { return false; }
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'a') {
        setHidden(h => {
          const next = !h;
          try { localStorage.setItem('ai-widget-hidden', next ? '1' : '0'); } catch { /* noop */ }
          return next;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<AIConfigState | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [configForm, setConfigForm] = useState({ provider: 'gemini', apiKey: '', model: '', baseUrl: '' });
  const [savingConfig, setSavingConfig] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  // Lightweight probe on mount — if user's role isn't on the AI allowlist
  // the backend returns 403, and we self-hide so the floating button stops
  // blocking clicks. No user action needed.
  useEffect(() => {
    api.get('/ai/config')
      .then(res => setConfig(res.data))
      .catch((err: { response?: { status?: number } }) => {
        if (err.response?.status === 403) {
          setHidden(true); // auto-hide — don't persist to localStorage so admins still see it
        } else {
          setConfig({ configured: true });
        }
      });
  }, []);

  useEffect(() => {
    if (open && config === null) {
      api.get('/ai/config')
        .then(res => setConfig(res.data))
        .catch((err: { response?: { status?: number } }) => {
          if (err.response?.status !== 403) setConfig({ configured: true });
        });
    }
  }, [open, config]);

  useEffect(() => {
    if (open && !showConfig) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open, showConfig]);

  // Match phrases like "give me excel", "download", "export it", "as xlsx", "csv"
  const isExcelRequest = (text: string): boolean => {
    const t = text.toLowerCase().trim();
    if (t.length > 80) return false; // long messages are new questions, not download requests
    return /\b(excel|xlsx|xls|download|export|sheet|spreadsheet)\b/.test(t);
  };

  const lastAssistantWithData = (): Message | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && extractDatasets(m.toolCalls).length > 0) return m;
    }
    return null;
  };

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    // Intercept "give me excel" / "download" / "export" → trigger Excel for the last answered message
    if (isExcelRequest(text)) {
      const src = lastAssistantWithData();
      if (src) {
        const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        try {
          await downloadExcel(src);
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(), role: 'assistant',
            content: '✓ Excel downloaded. Ask another question or say "download" again for the same data.',
            timestamp: new Date(),
          }]);
        } catch (err: unknown) {
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(), role: 'assistant',
            content: `Excel export failed: ${err?.message || 'unknown'}`,
            timestamp: new Date(),
          }]);
        }
        return;
      }
      // No prior data — fall through to AI (maybe they're asking about Excel something)
    }

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date() };
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const res = await api.post('/ai-v2/chat', {
        message: text,
        pageContext,
        history,
      });
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: res.data.reply,
        timestamp: new Date(),
        provider: res.data.provider,
        toolCalls: res.data.toolCalls,
        turns: res.data.turns,
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err: unknown) {
      const errorMsg = err?.response?.data?.error || err?.message || 'Failed to get response';
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: `Error: ${errorMsg}`, timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, pageContext, messages]);

  const downloadExcel = async (msg: Message) => {
    const sheets = extractDatasets(msg.toolCalls);
    if (sheets.length === 0) return;
    const userQuestion = (() => {
      const idx = messages.findIndex(m => m.id === msg.id);
      if (idx > 0 && messages[idx - 1].role === 'user') return messages[idx - 1].content;
      return 'AI Report';
    })();
    try {
      const res = await api.post('/ai-v2/export-excel', {
        title: userQuestion.slice(0, 100),
        sheets,
      }, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${userQuestion.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60) || 'report'}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(`Excel export failed: ${err?.message || 'unknown'}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await api.put('/ai/config', { provider: configForm.provider, apiKey: configForm.apiKey, model: configForm.model || undefined, baseUrl: configForm.baseUrl || undefined });
      setConfig({ configured: true, provider: configForm.provider, model: configForm.model });
      setShowConfig(false);
    } catch { alert('Failed to save AI config'); } finally { setSavingConfig(false); }
  };

  const formatContent = (text: string) => {
    return text.split('\n').map((line, i) => {
      if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-semibold">{line.slice(2, -2)}</p>;
      if (line.startsWith('- ')) return <p key={i} className="ml-3">• {line.slice(2)}</p>;
      if (line.trim() === '') return <br key={i} />;
      return <p key={i}>{line}</p>;
    });
  };

  const panelClass = expanded
    ? 'fixed inset-6 z-50 bg-white border border-slate-200 shadow-2xl flex flex-col overflow-hidden'
    : 'fixed bottom-6 right-6 z-50 w-[480px] h-[640px] bg-white border border-slate-200 shadow-2xl flex flex-col overflow-hidden';

  if (hidden) return null;

  return (
    <>
      {!open && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1 group">
          <button
            onClick={() => { setHidden(true); try { localStorage.setItem('ai-widget-hidden', '1'); } catch { /* noop */ } }}
            className="w-5 h-5 bg-slate-700 text-white text-[10px] opacity-0 group-hover:opacity-90 hover:bg-red-600 flex items-center justify-center transition-opacity"
            title="Hide (Alt+Shift+A to restore)"
          >×</button>
          <button
            onClick={() => setOpen(true)}
            className="w-10 h-10 bg-purple-600/80 hover:bg-purple-600 text-white shadow-lg flex items-center justify-center transition-all hover:scale-105"
            title="AI Reports & Assistant (Alt+Shift+A to hide)"
          >
            <Sparkles className="w-4 h-4" />
          </button>
        </div>
      )}

      {open && (
        <div className={panelClass} style={{ borderRadius: 0 }}>
          {/* Header */}
          <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-bold tracking-wide uppercase">AI Reports</span>
              <span className="text-[10px] text-slate-400">|</span>
              <span className="text-[10px] text-slate-400">Live ERP data · Excel export</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setExpanded(!expanded)} className="p-1.5 hover:bg-slate-700" title={expanded ? 'Compact' : 'Full screen'}>
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setShowConfig(!showConfig)} className="p-1.5 hover:bg-slate-700" title="Settings">
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-slate-700" title="Minimize">
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Config */}
          {showConfig && (
            <div className="p-4 bg-slate-50 border-b space-y-3 shrink-0">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">AI Provider</div>
              <select value={configForm.provider} onChange={(e) => { const p = PROVIDERS.find(p => p.value === e.target.value); setConfigForm({ ...configForm, provider: e.target.value, model: p?.modelDefault || '' }); }} className="w-full px-2.5 py-1.5 border border-slate-300 text-xs">
                {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <input type="password" placeholder={PROVIDERS.find(p => p.value === configForm.provider)?.placeholder || 'API Key'} value={configForm.apiKey} onChange={(e) => setConfigForm({ ...configForm, apiKey: e.target.value })} className="w-full px-2.5 py-1.5 border border-slate-300 text-xs" />
              <input type="text" placeholder={`Model (default: ${PROVIDERS.find(p => p.value === configForm.provider)?.modelDefault})`} value={configForm.model} onChange={(e) => setConfigForm({ ...configForm, model: e.target.value })} className="w-full px-2.5 py-1.5 border border-slate-300 text-xs" />
              <div className="flex gap-2">
                <button onClick={saveConfig} disabled={!configForm.apiKey || savingConfig} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50">{savingConfig ? 'Saving...' : 'Save'}</button>
                <button onClick={() => setShowConfig(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-bold uppercase tracking-widest hover:bg-slate-50">Cancel</button>
              </div>
              {config?.configured && <div className="text-[10px] text-slate-400">Current: {config.provider} ({config.keyHint})</div>}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {messages.length === 0 && !showConfig && (
              <div className="text-center py-6">
                <Sparkles className="w-10 h-10 text-purple-400 mx-auto mb-3" />
                <p className="text-sm text-slate-700 font-bold uppercase tracking-wide">Ask anything about your ERP</p>
                <p className="text-[11px] text-slate-500 mt-1">Live data · works offline of your memory · download as Excel</p>
                <div className="mt-4 space-y-1.5">
                  {getSuggestions(pageContext).map((s, i) => (
                    <button key={i} onClick={() => { setInput(s); inputRef.current?.focus(); }} className="block w-full text-left px-3 py-2 text-xs text-slate-700 bg-white hover:bg-purple-50 hover:text-purple-700 border border-slate-200 transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => {
              const datasets = msg.role === 'assistant' ? extractDatasets(msg.toolCalls) : [];
              const totalRows = datasets.reduce((s, d) => s + d.rows.length, 0);
              return (
                <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 bg-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                  <div className={`max-w-[85%] ${msg.role === 'user' ? '' : 'flex-1'}`}>
                    <div className={`px-3 py-2 text-xs leading-relaxed ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white text-slate-800 border border-slate-200'}`}>
                      {msg.role === 'assistant' ? formatContent(msg.content) : msg.content}
                    </div>

                    {/* Tool calls panel — transparency */}
                    {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mt-1.5 bg-slate-100 border border-slate-200 px-2 py-1.5 text-[10px] text-slate-600">
                        <div className="flex items-center gap-1 font-bold uppercase tracking-widest text-slate-500 mb-1">
                          <Wrench className="w-2.5 h-2.5" /> {msg.toolCalls.length} tool{msg.toolCalls.length > 1 ? 's' : ''} called · {msg.turns} turn{(msg.turns || 0) > 1 ? 's' : ''}
                        </div>
                        {msg.toolCalls.map((tc, i) => (
                          <div key={i} className="font-mono text-[10px] text-slate-600 truncate">
                            <span className="text-purple-700 font-bold">{tc.toolId.split('.').pop()}</span>
                            <span className="text-slate-400">({Object.entries(tc.args).map(([k, v]) => `${k}:${JSON.stringify(v)}`).join(', ')})</span>
                            <span className="text-slate-400 ml-1">· {tc.durationMs}ms</span>
                            {tc.error && <span className="text-red-600 ml-1">· error: {tc.error}</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Excel download hint — no button auto-shown. User types "excel" / "download" to get it. */}
                    {msg.role === 'assistant' && datasets.length > 0 && (
                      <div className="mt-1.5 text-[10px] text-slate-500 italic">
                        {totalRows} rows available · type <span className="font-mono text-emerald-700 font-bold">"give me excel"</span> for download
                      </div>
                    )}

                    {msg.role === 'assistant' && msg.provider && (
                      <div className="text-[9px] text-slate-400 mt-0.5 uppercase tracking-wider">via {msg.provider}</div>
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-6 h-6 bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                </div>
              );
            })}

            {loading && (
              <div className="flex gap-2 items-center">
                <div className="w-6 h-6 bg-slate-800 flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="bg-white border border-slate-200 px-3 py-2 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin text-purple-600" />
                  <span className="text-xs text-slate-500">Thinking & querying ERP...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-200 p-3 shrink-0 bg-white">
            <div className="flex gap-2">
              <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ask anything — e.g. 'how many trucks of rice husk came from 5th to 9th'" rows={1} className="flex-1 px-3 py-2 border border-slate-300 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-purple-500 max-h-24" style={{ minHeight: '36px' }} />
              <button onClick={sendMessage} disabled={!input.trim() || loading} className="px-3 py-2 bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function getSuggestions(context?: string): string[] {
  switch (context) {
    case 'dashboard': return ['Total ethanol production this month', 'Outstanding payables > 5 lakhs', 'Trucks that came today'];
    case 'fermentation': return ['Average fermentation time this month', 'Batches with low yield this week'];
    case 'distillation': return ['Today\'s ethanol production summary', 'Average RS strength this week'];
    case 'sales': case 'invoices': return ['Unpaid invoices total', 'Sales invoices this month', 'Top 5 customers by outstanding'];
    case 'procurement': return ['Vendor outstanding > 1 lakh', 'GRNs received today', 'Coal trucks last week'];
    case 'inventory': return ['Items below reorder level', 'Total inventory value'];
    case 'accounts': return ['Trial balance summary', 'TDS payable balance', 'Cash in hand'];
    default: return [
      'Total ethanol production this month',
      'How many trucks came today?',
      'Outstanding to vendors > 5 lakhs',
      'TDS payable balance',
    ];
  }
}
