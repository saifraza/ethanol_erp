/**
 * EmailThreadDrawer — Gmail-style reusable email thread viewer.
 *
 * Works for ANY ERP module that sends email through /api/email-threads.
 * Lookup modes (pass ONE of these via props):
 *   { entityType, entityId }           — show threads tied to a specific entity (e.g. a PO, an indent quote row)
 *   { vendorId }                       — show ALL threads with a vendor (across POs, RFQs, invoices)
 *   { customerId }                     — show ALL threads with a customer
 *   { threadId }                       — show a single thread directly
 *
 * Features (Gmail-like):
 *   - Left pane: thread list sorted by most recent, unread dot, reply count
 *   - Right pane: full thread — sent message + replies, collapsible, attachments
 *   - Reply composer inline (plain text)
 *   - Resend button
 *   - AI Extract button (when the parent module provides onExtractAI callback)
 *   - Check for new replies (IMAP sync)
 *   - Attachment previews
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { X, Mail, Send, RefreshCw, Paperclip, Sparkles, ChevronDown, ChevronUp, Inbox } from 'lucide-react';

const REPLY_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // matches backend multer limit
const REPLY_ATTACHMENT_MAX_FILES = 5;

export interface EmailThreadQuery {
  entityType?: string;
  entityId?: string;
  vendorId?: string;
  customerId?: string;
  threadId?: string;
}

interface Thread {
  id: string;
  entityType: string;
  entityId: string;
  subject: string;
  fromEmail: string;
  fromName?: string | null;
  toEmail: string;
  ccEmail?: string | null;
  bodyText: string;
  bodyHtml?: string | null;
  sentAt: string;
  sentBy: string;
  status: string;
  errorMessage?: string | null;
  attachments: Array<{ filename: string; size: number; contentType: string }> | null;
  replyCount: number;
  hasUnreadReply: boolean;
  vendor?: { id: string; name: string; email?: string; phone?: string } | null;
  customer?: { id: string; name: string } | null;
  _count?: { replies: number };
}

interface Reply {
  id: string;
  providerMessageId: string;
  fromEmail: string;
  fromName?: string | null;
  subject?: string | null;
  bodyText: string;
  bodyHtml?: string | null;
  receivedAt: string;
  attachments: Array<{ filename: string; size: number; contentType: string }> | null;
  aiExtractedJson?: unknown;
  aiExtractedAt?: string | null;
  aiConfidence?: string | null;
  seenAt?: string | null;
}

interface ThreadDetail extends Thread {
  replies: Reply[];
}

interface Props {
  query: EmailThreadQuery;
  title?: string;                                     // drawer title (e.g. "Emails with Acme Steel")
  contextLabel?: string;                              // subtitle (e.g. "PO #123" or "Indent #4 / Vendor quote")
  onClose: () => void;
  onExtractAI?: (threadId: string, replyId: string) => Promise<void>; // optional AI extract hook (parent knows how to extract for this entity)
  showComposer?: boolean;                             // true = show reply composer (default true)
  emptyStateAction?: {
    label: string;
    onClick: (remarks?: string) => void | Promise<void>;
    /** Optional prompt text shown above the textarea in the empty state */
    remarksLabel?: string;
    /** If provided, an extra "Preview PDF" button appears */
    previewUrl?: string;
  };
}

function fmtDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) +
    ' · ' + dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function initials(name?: string | null, email?: string): string {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] || '?').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
}

export default function EmailThreadDrawer({ query, title, contextLabel, onClose, onExtractAI, showComposer = true, emptyStateAction }: Props) {
  const [emptyRemarks, setEmptyRemarks] = useState('');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [resending, setResending] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replyAttachments, setReplyAttachments] = useState<File[]>([]);
  const replyFileInputRef = useRef<HTMLInputElement | null>(null);
  const [replySending, setReplySending] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [extractingId, setExtractingId] = useState<string | null>(null);

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.entityType && query.entityId) { params.set('entityType', query.entityType); params.set('entityId', query.entityId); }
      if (query.vendorId) params.set('vendorId', query.vendorId);
      if (query.customerId) params.set('customerId', query.customerId);
      if (query.threadId) {
        // Load the specific thread directly — single-thread mode
        const res = await api.get<ThreadDetail>(`/email-threads/${query.threadId}`);
        setThreads([res.data as Thread]);
        setSelectedThreadId(res.data.id);
        setDetail(res.data);
        setLoading(false);
        return;
      }
      const res = await api.get<{ threads: Thread[] }>(`/email-threads?${params.toString()}`);
      setThreads(res.data.threads);
      // Auto-select the most recent thread
      if (res.data.threads.length > 0 && !selectedThreadId) {
        setSelectedThreadId(res.data.threads[0].id);
      }
    } catch (e) {
      console.error('Failed to fetch threads', e);
    }
    setLoading(false);
  }, [query.entityType, query.entityId, query.vendorId, query.customerId, query.threadId, selectedThreadId]);

  const fetchDetail = useCallback(async (threadId: string) => {
    try {
      const res = await api.get<ThreadDetail>(`/email-threads/${threadId}`);
      setDetail(res.data);
      // Auto-mark replies as seen
      if (res.data.hasUnreadReply) {
        await api.post(`/email-threads/${threadId}/mark-seen`);
        fetchThreads();
      }
      // Auto-expand the latest reply
      const latest = res.data.replies[res.data.replies.length - 1];
      if (latest) setExpandedReplies(prev => ({ ...prev, [latest.id]: true }));
    } catch (e) { console.error('Failed to fetch detail', e); }
  }, [fetchThreads]);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);
  useEffect(() => { if (selectedThreadId) fetchDetail(selectedThreadId); }, [selectedThreadId, fetchDetail]);

  const handleSync = async () => {
    if (!selectedThreadId) return;
    setSyncing(true);
    try {
      const res = await api.post<{ replies: Reply[]; newCount: number; fetchError?: string }>(`/email-threads/${selectedThreadId}/sync`);
      if (res.data.fetchError) alert(`IMAP fetch issue: ${res.data.fetchError}`);
      await fetchDetail(selectedThreadId);
      fetchThreads();
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Sync failed');
    }
    setSyncing(false);
  };

  const handleResend = async () => {
    if (!selectedThreadId) return;
    if (!confirm('Resend this email to the same recipient? A new Message-ID will be used.')) return;
    setResending(true);
    try {
      await api.post(`/email-threads/${selectedThreadId}/resend`);
      alert('Resent successfully.');
      fetchThreads();
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Resend failed');
    }
    setResending(false);
  };

  const handleReply = async () => {
    if (!selectedThreadId || !replyBody.trim()) return;
    setReplySending(true);
    try {
      if (replyAttachments.length > 0) {
        const fd = new FormData();
        fd.append('bodyText', replyBody);
        for (const f of replyAttachments) fd.append('attachments', f, f.name);
        await api.post(`/email-threads/${selectedThreadId}/reply`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } else {
        await api.post(`/email-threads/${selectedThreadId}/reply`, { bodyText: replyBody });
      }
      setReplyBody('');
      setReplyAttachments([]);
      if (replyFileInputRef.current) replyFileInputRef.current.value = '';
      await fetchDetail(selectedThreadId);
      fetchThreads();
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Reply failed');
    }
    setReplySending(false);
  };

  const handlePickReplyFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(e.target.files || []);
    if (!incoming.length) return;
    const merged = [...replyAttachments];
    const rejected: string[] = [];
    for (const f of incoming) {
      if (merged.length >= REPLY_ATTACHMENT_MAX_FILES) { rejected.push(`${f.name} (max ${REPLY_ATTACHMENT_MAX_FILES} files)`); continue; }
      if (f.size > REPLY_ATTACHMENT_MAX_BYTES) { rejected.push(`${f.name} (>25MB)`); continue; }
      if (merged.some(m => m.name === f.name && m.size === f.size)) continue;
      merged.push(f);
    }
    setReplyAttachments(merged);
    if (rejected.length) alert(`Skipped: ${rejected.join(', ')}`);
    // Reset input so picking the same file again still fires onChange
    if (replyFileInputRef.current) replyFileInputRef.current.value = '';
  };

  const removeReplyAttachment = (idx: number) => {
    setReplyAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const handleExtract = async (replyId: string) => {
    if (!onExtractAI || !selectedThreadId) return;
    setExtractingId(replyId);
    try {
      await onExtractAI(selectedThreadId, replyId);
      await fetchDetail(selectedThreadId);
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'AI extract failed');
    }
    setExtractingId(null);
  };

  const openAttachment = async (threadId: string, replyId: string | null, filename: string) => {
    try {
      const url = replyId
        ? `/email-threads/${threadId}/reply/${replyId}/attachment/${encodeURIComponent(filename)}`
        : null;
      if (!url) return;
      const res = await api.get(url, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data as Blob);
      window.open(blobUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to load attachment');
    }
  };

  const displayTitle = title || (query.vendorId ? 'Emails with Vendor' : query.customerId ? 'Emails with Customer' : 'Email Thread');

  return (
    <div className="fixed inset-0 bg-black/40 flex items-stretch justify-end z-50" onClick={onClose}>
      <div className="bg-white shadow-2xl w-full max-w-5xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Mail size={16} />
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest">{displayTitle}</h2>
              {contextLabel && <div className="text-[10px] text-slate-400">{contextLabel}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedThreadId && (
              <>
                <button onClick={handleSync} disabled={syncing}
                  className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-[10px] flex items-center gap-1 disabled:opacity-50">
                  <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Checking...' : 'Check Replies'}
                </button>
                <button onClick={handleResend} disabled={resending}
                  className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-[10px] flex items-center gap-1 disabled:opacity-50">
                  <Send size={11} /> {resending ? 'Resending...' : 'Resend'}
                </button>
              </>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xs px-1"><X size={14} /></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Thread list (left pane) */}
          <div className="w-72 border-r border-slate-200 overflow-y-auto bg-slate-50">
            {loading && <div className="p-4 text-[11px] text-slate-400 text-center">Loading...</div>}
            {!loading && threads.length === 0 && (
              <div className="p-6 text-center space-y-3">
                <Inbox size={20} className="mx-auto text-slate-300" />
                <div className="text-[11px] text-slate-500 leading-relaxed">
                  No emails yet.
                  <br />
                  <span className="text-[10px] text-slate-400">
                    Any RFQ / PO sent before this feature went live won't appear here. Send a fresh email to start tracking.
                  </span>
                </div>
                {emptyStateAction && (
                  <div className="text-[10px] text-slate-400 italic">→ Use the panel on the right to send</div>
                )}
              </div>
            )}
            {threads.map(t => {
              const active = t.id === selectedThreadId;
              return (
                <button key={t.id} onClick={() => setSelectedThreadId(t.id)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-200 ${active ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'hover:bg-white'}`}>
                  <div className="flex items-center gap-2">
                    {t.hasUnreadReply && <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                    <div className="text-[11px] font-bold text-slate-800 truncate flex-1">{t.toEmail.split(',')[0].trim()}</div>
                    {t.replyCount > 0 && <span className="text-[9px] bg-slate-200 text-slate-700 px-1 py-0 font-bold">{t.replyCount + 1}</span>}
                  </div>
                  <div className="text-[11px] text-slate-700 truncate mt-0.5">{t.subject}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{fmtDate(t.sentAt)}</div>
                  {t.status === 'FAILED' && <div className="text-[9px] text-red-600 font-bold mt-0.5">FAILED</div>}
                </button>
              );
            })}
          </div>

          {/* Detail (right pane) */}
          <div className="flex-1 overflow-y-auto">
            {!detail && !loading && threads.length > 0 && (
              <div className="p-8 text-center text-xs text-slate-400">Select a thread on the left</div>
            )}
            {!detail && !loading && threads.length === 0 && (
              <div className="p-10 text-center space-y-3 max-w-md mx-auto">
                <Inbox size={32} className="mx-auto text-slate-300" />
                <div className="text-sm text-slate-600 font-medium">No email history for this yet</div>
                <div className="text-[11px] text-slate-500 leading-relaxed">
                  Either this is the first time we're emailing this contact, or previous emails were sent before email tracking was switched on.
                </div>
                {emptyStateAction && (
                  <div className="space-y-2 pt-2 text-left">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">
                      {emptyStateAction.remarksLabel || 'Special Remarks (optional)'}
                    </label>
                    <textarea value={emptyRemarks} onChange={e => setEmptyRemarks(e.target.value)} rows={3}
                      placeholder="Anything specific you want the vendor to note — delivery deadline, quality spec, preferred brand, etc."
                      className="w-full border border-slate-300 px-2 py-1.5 text-xs outline-none resize-none bg-white" />
                    <div className="flex gap-2 justify-center pt-1">
                      {emptyStateAction.previewUrl && (
                        <button onClick={async () => {
                          const res = await api.get(emptyStateAction.previewUrl + (emptyRemarks ? `?remarks=${encodeURIComponent(emptyRemarks)}` : ''), { responseType: 'blob' });
                          const url = URL.createObjectURL(res.data as Blob);
                          window.open(url, '_blank');
                          setTimeout(() => URL.revokeObjectURL(url), 60000);
                        }}
                          className="px-3 py-2 bg-white border border-slate-400 text-slate-700 text-xs font-medium hover:bg-slate-100 flex items-center justify-center gap-1">
                          Preview PDF
                        </button>
                      )}
                      <button onClick={() => emptyStateAction.onClick(emptyRemarks || undefined)}
                        className="px-4 py-2 bg-blue-600 text-white text-xs font-bold uppercase tracking-wide hover:bg-blue-700 flex items-center justify-center gap-1">
                        <Send size={12} /> {emptyStateAction.label}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {detail && (
              <div className="divide-y divide-slate-200">
                {/* Subject bar */}
                <div className="px-4 py-3 bg-white sticky top-0 z-10 border-b border-slate-300">
                  <div className="text-sm font-bold text-slate-900">{detail.subject}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {detail.vendor?.name && <span>{detail.vendor.name} · </span>}
                    To: {detail.toEmail}
                    {detail.ccEmail && <> · CC: {detail.ccEmail}</>}
                  </div>
                </div>

                {/* Sent message (always expanded at top) */}
                <div className="px-4 py-3 bg-slate-50">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-slate-700 text-white text-[10px] font-bold rounded-full flex items-center justify-center shrink-0">
                      {initials(detail.fromName || undefined, detail.fromEmail)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px]">
                          <span className="font-bold text-slate-800">{detail.fromName || detail.fromEmail}</span>
                          <span className="text-slate-400 ml-2">(me)</span>
                          <span className="text-slate-500 ml-3">to {detail.toEmail}</span>
                        </div>
                        <div className="text-[10px] text-slate-500">{fmtDate(detail.sentAt)}</div>
                      </div>
                      <div className="text-[9px] text-slate-400 uppercase tracking-widest mt-0.5">
                        Sent by {detail.sentBy} · {detail.status}
                        {detail.errorMessage && <span className="text-red-600 ml-2">{detail.errorMessage}</span>}
                      </div>
                      <div className="text-[11px] text-slate-700 whitespace-pre-wrap mt-2 max-h-60 overflow-y-auto bg-white border border-slate-200 p-2">
                        {detail.bodyText}
                      </div>
                      {detail.attachments && detail.attachments.length > 0 && (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <Paperclip size={10} className="text-slate-500" />
                          {detail.attachments.map((a, ai) => (
                            <span key={ai} className="text-[10px] text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5" title={`${(a.size / 1024).toFixed(1)} KB`}>
                              {a.filename}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Replies */}
                {detail.replies.map(r => {
                  const expanded = expandedReplies[r.id] ?? false;
                  const extracted = r.aiExtractedJson as Record<string, unknown> | null | undefined;
                  return (
                    <div key={r.id} className="px-4 py-3 bg-white">
                      <button onClick={() => setExpandedReplies(prev => ({ ...prev, [r.id]: !expanded }))}
                        className="w-full flex items-start gap-3 text-left">
                        <div className="w-8 h-8 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center shrink-0">
                          {initials(r.fromName, r.fromEmail)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div className="text-[11px]">
                              <span className="font-bold text-slate-800">{r.fromName || r.fromEmail}</span>
                              {r.fromName && <span className="text-slate-400 ml-2">&lt;{r.fromEmail}&gt;</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              {r.aiExtractedAt && <span className="text-[9px] text-purple-600 bg-purple-50 px-1 font-bold">AI ✓</span>}
                              <div className="text-[10px] text-slate-500">{fmtDate(r.receivedAt)}</div>
                              {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                            </div>
                          </div>
                          {!expanded && (
                            <div className="text-[10px] text-slate-500 mt-0.5 truncate">{r.bodyText.slice(0, 120)}</div>
                          )}
                        </div>
                      </button>

                      {expanded && (
                        <div className="ml-11 mt-2 space-y-2">
                          <div className="text-[11px] text-slate-700 whitespace-pre-wrap max-h-80 overflow-y-auto bg-slate-50 border border-slate-200 p-2">
                            {r.bodyText || '(no text body)'}
                          </div>

                          {r.attachments && r.attachments.length > 0 && (
                            <div className="flex items-center gap-2 flex-wrap">
                              <Paperclip size={10} className="text-slate-500" />
                              {r.attachments.map((a, ai) => (
                                <button key={ai} onClick={() => openAttachment(detail.id, r.id, a.filename)}
                                  className="text-[10px] text-blue-600 hover:text-blue-800 underline flex items-center gap-0.5 bg-white border border-slate-200 px-1.5 py-0.5"
                                  title={`${(a.size / 1024).toFixed(1)} KB · ${a.contentType}`}>
                                  {a.filename}
                                </button>
                              ))}
                            </div>
                          )}

                          {onExtractAI && (
                            <div>
                              <button onClick={() => handleExtract(r.id)} disabled={extractingId === r.id}
                                className="px-2 py-1 bg-purple-600 text-white text-[10px] font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1">
                                <Sparkles size={10} /> {extractingId === r.id ? 'AI Reading...' : r.aiExtractedAt ? 'Re-extract with AI' : 'AI Extract'}
                              </button>
                            </div>
                          )}

                          {extracted != null && typeof extracted === 'object' && (
                            <div className="border border-purple-200 bg-purple-50/40 p-2 text-[10px]">
                              <div className="font-bold text-purple-800 uppercase tracking-widest mb-1 flex items-center gap-1">
                                <Sparkles size={10} /> AI Extracted {r.aiConfidence ? `(${r.aiConfidence})` : ''}
                              </div>
                              <pre className="whitespace-pre-wrap text-[10px] text-slate-700 max-h-40 overflow-y-auto">{JSON.stringify(extracted, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {detail.replies.length === 0 && (
                  <div className="px-4 py-6 text-center text-[11px] text-slate-400 italic">
                    No replies yet. Click "Check Replies" at the top to pull from Gmail.
                  </div>
                )}

                {/* Composer */}
                {showComposer && (
                  <div className="px-4 py-3 bg-slate-50">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Reply</div>
                    <textarea value={replyBody} onChange={e => setReplyBody(e.target.value)} rows={3}
                      placeholder={`Reply to ${detail.toEmail.split(',')[0]}...`}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none resize-none bg-white" />
                    {replyAttachments.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                        {replyAttachments.map((f, i) => (
                          <span key={`${f.name}-${i}`} className="text-[10px] text-slate-700 bg-white border border-slate-300 pl-1.5 pr-1 py-0.5 flex items-center gap-1" title={`${(f.size / 1024).toFixed(1)} KB`}>
                            <Paperclip size={9} className="text-slate-500" />
                            <span className="max-w-[160px] truncate">{f.name}</span>
                            <span className="text-slate-400">{(f.size / 1024).toFixed(0)}KB</span>
                            <button type="button" onClick={() => removeReplyAttachment(i)} className="text-slate-400 hover:text-red-600" aria-label={`Remove ${f.name}`}>
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <div>
                        <input ref={replyFileInputRef} type="file" multiple onChange={handlePickReplyFiles} className="hidden" />
                        <button type="button" onClick={() => replyFileInputRef.current?.click()}
                          disabled={replyAttachments.length >= REPLY_ATTACHMENT_MAX_FILES}
                          className="px-2 py-1 bg-white border border-slate-300 text-slate-700 text-[11px] font-medium hover:bg-slate-100 disabled:opacity-50 flex items-center gap-1"
                          title={`Up to ${REPLY_ATTACHMENT_MAX_FILES} files · 25MB each`}>
                          <Paperclip size={11} /> Attach
                        </button>
                      </div>
                      <button onClick={handleReply} disabled={replySending || !replyBody.trim()}
                        className="px-3 py-1 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-wide hover:bg-blue-700 disabled:bg-slate-400 flex items-center gap-1">
                        <Send size={11} /> {replySending ? 'Sending...' : 'Send Reply'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
