import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, X, Send, Loader2, Bot, User, Minimize2, Settings, ChevronDown } from 'lucide-react';
import api from '../services/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface AIConfigState {
  configured: boolean;
  provider?: string;
  model?: string;
  keyHint?: string;
}

const PROVIDERS = [
  { value: 'openclaw', label: 'OpenClaw', placeholder: 'Gateway token', modelDefault: 'openclaw' },
  { value: 'gemini', label: 'Google Gemini', placeholder: 'API key from Google AI Studio', modelDefault: 'gemini-2.5-flash' },
  { value: 'openai', label: 'OpenAI', placeholder: 'sk-... API key', modelDefault: 'gpt-4o-mini' },
  { value: 'anthropic', label: 'Anthropic Claude', placeholder: 'sk-ant-... API key', modelDefault: 'claude-sonnet-4-20250514' },
];

export default function AIChatWidget({ pageContext }: { pageContext?: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<AIConfigState | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [configForm, setConfigForm] = useState({ provider: 'openclaw', apiKey: '', model: '', baseUrl: '' });
  const [savingConfig, setSavingConfig] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  // Check AI config on first open
  useEffect(() => {
    if (open && config === null) {
      api.get('/ai/config').then(res => setConfig(res.data)).catch(() => setConfig({ configured: false }));
    }
  }, [open, config]);

  // Focus input when opened
  useEffect(() => {
    if (open && !showConfig) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, showConfig]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.post('/ai/chat', {
        message: text,
        context: pageContext,
      });

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: res.data.reply,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to get response';
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${errorMsg}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, pageContext]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await api.put('/ai/config', {
        provider: configForm.provider,
        apiKey: configForm.apiKey,
        model: configForm.model || undefined,
        baseUrl: configForm.baseUrl || undefined,
      });
      setConfig({ configured: true, provider: configForm.provider, model: configForm.model });
      setShowConfig(false);
    } catch {
      alert('Failed to save AI config');
    } finally {
      setSavingConfig(false);
    }
  };

  // Format markdown-like text simply
  const formatContent = (text: string) => {
    return text.split('\n').map((line, i) => {
      if (line.startsWith('**') && line.endsWith('**')) {
        return <p key={i} className="font-semibold">{line.slice(2, -2)}</p>;
      }
      if (line.startsWith('- ')) {
        return <p key={i} className="ml-3">• {line.slice(2)}</p>;
      }
      if (line.trim() === '') return <br key={i} />;
      return <p key={i}>{line}</p>;
    });
  };

  return (
    <>
      {/* Floating Button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 flex items-center justify-center transition-all hover:scale-105"
          title="AI Assistant"
        >
          <MessageSquare className="w-6 h-6" />
        </button>
      )}

      {/* Chat Panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 w-[400px] h-[560px] bg-white border border-slate-200 shadow-2xl flex flex-col overflow-hidden"
          style={{ borderRadius: 0 }}>

          {/* Header */}
          <div className="bg-slate-800 text-white px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5" />
              <div>
                <span className="text-sm font-bold">AI Assistant</span>
                {config?.configured && (
                  <span className="text-[10px] text-slate-400 ml-2 uppercase">{config.provider}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowConfig(!showConfig)} className="p-1.5 hover:bg-slate-700 rounded" title="AI Settings">
                <Settings className="w-4 h-4" />
              </button>
              <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-slate-700 rounded" title="Close">
                <Minimize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Config Panel */}
          {showConfig && (
            <div className="p-4 bg-slate-50 border-b space-y-3 shrink-0">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">AI Provider Configuration</div>
              <select
                value={configForm.provider}
                onChange={(e) => {
                  const p = PROVIDERS.find(p => p.value === e.target.value);
                  setConfigForm({ ...configForm, provider: e.target.value, model: p?.modelDefault || '' });
                }}
                className="w-full px-2.5 py-1.5 border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              {configForm.provider === 'openclaw' && (
                <input
                  type="text"
                  placeholder="OpenClaw URL (e.g. https://openclaw-xxx.up.railway.app)"
                  value={configForm.baseUrl}
                  onChange={(e) => setConfigForm({ ...configForm, baseUrl: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              )}
              <input
                type="password"
                placeholder={PROVIDERS.find(p => p.value === configForm.provider)?.placeholder || 'API Key'}
                value={configForm.apiKey}
                onChange={(e) => setConfigForm({ ...configForm, apiKey: e.target.value })}
                className="w-full px-2.5 py-1.5 border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
              <input
                type="text"
                placeholder={`Model (default: ${PROVIDERS.find(p => p.value === configForm.provider)?.modelDefault})`}
                value={configForm.model}
                onChange={(e) => setConfigForm({ ...configForm, model: e.target.value })}
                className="w-full px-2.5 py-1.5 border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
              <div className="flex gap-2">
                <button onClick={saveConfig} disabled={!configForm.apiKey || savingConfig}
                  className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                  {savingConfig ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setShowConfig(false)}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                  Cancel
                </button>
              </div>
              {config?.configured && (
                <div className="text-[10px] text-slate-400">
                  Current: {config.provider} ({config.keyHint})
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !showConfig && (
              <div className="text-center py-8">
                <Bot className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500 font-medium">Ask me anything about your ERP data</p>
                <p className="text-xs text-slate-400 mt-1">
                  {pageContext ? `Context: ${pageContext}` : 'Production, sales, accounts, inventory...'}
                </p>
                <div className="mt-4 space-y-2">
                  {getSuggestions(pageContext).map((s, i) => (
                    <button key={i} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                      className="block w-full text-left px-3 py-2 text-xs text-slate-600 bg-slate-50 hover:bg-blue-50 hover:text-blue-700 border border-slate-200 transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-6 h-6 bg-slate-800 flex items-center justify-center shrink-0 mt-1">
                    <Bot className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
                <div className={`max-w-[80%] px-3 py-2 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                }`}>
                  {msg.role === 'assistant' ? formatContent(msg.content) : msg.content}
                </div>
                {msg.role === 'user' && (
                  <div className="w-6 h-6 bg-blue-600 flex items-center justify-center shrink-0 mt-1">
                    <User className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex gap-2 items-center">
                <div className="w-6 h-6 bg-slate-800 flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="bg-slate-100 border border-slate-200 px-3 py-2 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin text-slate-500" />
                  <span className="text-xs text-slate-500">Thinking...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-200 p-3 shrink-0">
            {!config?.configured && !showConfig ? (
              <button onClick={() => setShowConfig(true)}
                className="w-full py-2 text-xs text-blue-600 bg-blue-50 border border-blue-200 hover:bg-blue-100">
                Configure AI Provider to get started
              </button>
            ) : (
              <div className="flex gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  rows={1}
                  className="flex-1 px-3 py-2 border border-slate-300 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 max-h-20"
                  style={{ minHeight: '36px' }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                  className="px-3 py-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function getSuggestions(context?: string): string[] {
  switch (context) {
    case 'dashboard':
      return [
        'Summarize today\'s production',
        'Compare this week vs last week',
        'Which area needs attention?',
      ];
    case 'fermentation':
      return [
        'Which batches have low yield?',
        'Average fermentation time this month?',
        'Any batches with abnormal gravity?',
      ];
    case 'distillation':
      return [
        'Today\'s ethanol production summary',
        'Average RS strength this week?',
        'Tank-wise stock overview',
      ];
    case 'sales':
    case 'invoices':
      return [
        'Pending invoices total',
        'Which customers have overdue payments?',
        'Sales trend this month',
      ];
    case 'procurement':
      return [
        'Open purchase orders',
        'Vendor payment status',
        'Materials with pending GRN',
      ];
    case 'inventory':
      return [
        'Items below reorder level',
        'Total inventory value',
        'Most used items this month',
      ];
    case 'accounts':
      return [
        'Trial balance summary',
        'Pending receivables',
        'Today\'s journal entries',
      ];
    default:
      return [
        'Summarize today\'s operations',
        'Any pending tasks?',
        'Production overview this week',
      ];
  }
}
