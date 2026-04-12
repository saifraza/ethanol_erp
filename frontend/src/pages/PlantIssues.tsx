import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { AlertCircle, Plus, MessageSquare, CheckCircle, Clock, Wrench, Zap, X, Send, ChevronDown, ChevronUp } from 'lucide-react';

const TYPES = ['MECHANICAL', 'ELECTRICAL', 'INSTRUMENTATION', 'CIVIL', 'SAFETY', 'OTHER'];
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const SEV_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-600 text-white', HIGH: 'bg-orange-500 text-white',
  MEDIUM: 'bg-yellow-400 text-gray-900', LOW: 'bg-gray-300 text-gray-700',
};
const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-red-100 text-red-700', ASSIGNED: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-700', RESOLVED: 'bg-green-100 text-green-700',
  CLOSED: 'bg-gray-100 text-gray-600',
};
const TYPE_ICONS: Record<string, any> = {
  MECHANICAL: Wrench, ELECTRICAL: Zap, INSTRUMENTATION: Clock,
};

interface Issue {
  id: string; issueNo: number; title: string; description: string;
  issueType: string; severity: string; equipment: string | null; location: string | null;
  status: string; assignedTo: string | null; resolvedAt: string | null;
  resolution: string | null; downtimeHours: number | null; reportedBy: string;
  createdAt: string; comments: any[];
}

export default function PlantIssues() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'list' | 'new'>('list');
  const [filterStatus, setFilterStatus] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [form, setForm] = useState({
    title: '', description: '', issueType: 'MECHANICAL', severity: 'MEDIUM', equipment: '', location: '',
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const [issuesRes, statsRes] = await Promise.all([
        api.get('/issues' + (filterStatus ? `?status=${filterStatus}` : '')),
        api.get('/issues/stats'),
      ]);
      setIssues(issuesRes.data.issues);
      setStats(statsRes.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterStatus]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/issues', form);
      setForm({ title: '', description: '', issueType: 'MECHANICAL', severity: 'MEDIUM', equipment: '', location: '' });
      setTab('list');
      load();
    } catch (e: any) { alert(e.response?.data?.error || 'Error'); }
    setSaving(false);
  };

  const updateStatus = async (id: string, status: string, extra?: any) => {
    try {
      await api.put(`/issues/${id}`, { status, ...extra });
      load();
    } catch (e: any) { alert(e.response?.data?.error || 'Error'); }
  };

  const addComment = async (issueId: string) => {
    if (!comment.trim()) return;
    try {
      await api.post(`/issues/${issueId}/comment`, { message: comment });
      setComment('');
      load();
    } catch (e: any) { alert('Error adding comment'); }
  };

  if (loading) return <div className="p-6 text-center text-gray-400">Loading issues...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold flex items-center gap-2"><AlertCircle size={22} /> Plant Issues</h1>
        <button onClick={() => setTab('new')} className="btn-primary text-sm flex items-center gap-1"><Plus size={16} /> Report Issue</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
        {STATUSES.map(s => (
          <div key={s} className={`card p-3 text-center cursor-pointer ${filterStatus === s ? 'ring-2 ring-blue-400' : ''}`}
            onClick={() => setFilterStatus(filterStatus === s ? '' : s)}>
            <div className="text-xs text-gray-500">{s.replace('_', ' ')}</div>
            <div className="text-lg font-bold">{stats.byStatus?.[s] || 0}</div>
          </div>
        ))}
        <div className="card p-3 text-center">
          <div className="text-xs text-gray-500">Avg Resolution</div>
          <div className="text-lg font-bold">{stats.mttr || 0}h</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button onClick={() => setTab('list')} className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === 'list' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'}`}>
          Issues ({issues.length})
        </button>
        <button onClick={() => setTab('new')} className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === 'new' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'}`}>
          + Report New
        </button>
      </div>

      {/* New Issue Form */}
      {tab === 'new' && (
        <form onSubmit={handleCreate} className="card p-4 space-y-3">
          <h3 className="font-semibold">Report Plant Issue</h3>
          <input className="input-field w-full" placeholder="Issue Title *" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <textarea className="input-field w-full" rows={3} placeholder="Description — what's wrong, when did it start?" value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Type</label>
              <select className="input-field w-full" value={form.issueType} onChange={e => setForm({ ...form, issueType: e.target.value })}>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Severity</label>
              <select className="input-field w-full" value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <input className="input-field" placeholder="Equipment (e.g., Fermenter 2 Pump)" value={form.equipment} onChange={e => setForm({ ...form, equipment: e.target.value })} />
            <input className="input-field" placeholder="Location (e.g., Boiler Room)" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
          </div>
          <button type="submit" disabled={saving} className="btn-primary w-full md:w-auto">{saving ? 'Saving...' : 'Submit Issue'}</button>
        </form>
      )}

      {/* Issues List */}
      {tab === 'list' && (
        <div className="space-y-2">
          {issues.length === 0 && <div className="card p-6 text-center text-gray-400">No issues found</div>}
          {issues.map(issue => {
            const isExpanded = expanded === issue.id;
            const Icon = TYPE_ICONS[issue.issueType] || AlertCircle;
            return (
              <div key={issue.id} className="card overflow-hidden">
                <div className="p-3 flex items-start gap-3 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : issue.id)}>
                  <Icon size={20} className="text-gray-400 mt-1 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">#{issue.issueNo} {issue.title}</span>
                      <span className={`px-2 py-0.5 text-xs ${SEV_COLORS[issue.severity]}`}>{issue.severity}</span>
                      <span className={`px-2 py-0.5 text-xs ${STATUS_COLORS[issue.status]}`}>{issue.status.replace('_', ' ')}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {issue.equipment && <span>{issue.equipment} · </span>}
                      {issue.reportedBy} · {new Date(issue.createdAt).toLocaleDateString()}
                      {issue.assignedTo && <span> · Assigned: {issue.assignedTo}</span>}
                      {issue.comments?.length > 0 && <span> · <MessageSquare size={11} className="inline" /> {issue.comments.length}</span>}
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>

                {isExpanded && (
                  <div className="border-t p-3 space-y-3 bg-gray-50">
                    {issue.description && <p className="text-sm text-gray-700">{issue.description}</p>}
                    {issue.location && <p className="text-xs text-gray-500">Location: {issue.location}</p>}

                    {/* Status actions */}
                    <div className="flex flex-wrap gap-2">
                      {issue.status === 'OPEN' && (
                        <>
                          <button onClick={() => {
                            const name = prompt('Assign to (name):');
                            if (name) updateStatus(issue.id, 'ASSIGNED', { assignedTo: name });
                          }} className="btn-secondary text-xs">Assign</button>
                          <button onClick={() => updateStatus(issue.id, 'IN_PROGRESS')} className="btn-secondary text-xs">Start Work</button>
                        </>
                      )}
                      {issue.status === 'ASSIGNED' && (
                        <button onClick={() => updateStatus(issue.id, 'IN_PROGRESS')} className="btn-secondary text-xs">Start Work</button>
                      )}
                      {issue.status === 'IN_PROGRESS' && (
                        <button onClick={() => {
                          const resolution = prompt('Resolution notes:');
                          const hours = prompt('Downtime hours:');
                          updateStatus(issue.id, 'RESOLVED', { resolution, downtimeHours: hours });
                        }} className="btn-primary text-xs flex items-center gap-1"><CheckCircle size={14} /> Resolve</button>
                      )}
                      {issue.status === 'RESOLVED' && (
                        <button onClick={() => updateStatus(issue.id, 'CLOSED')} className="btn-secondary text-xs">Close</button>
                      )}
                    </div>

                    {issue.resolution && (
                      <div className="text-sm bg-green-50 p-2">
                        <strong className="text-green-700">Resolution:</strong> {issue.resolution}
                        {issue.downtimeHours && <span className="text-xs text-gray-500 ml-2">({issue.downtimeHours}h downtime)</span>}
                      </div>
                    )}

                    {/* Comments */}
                    {issue.comments && issue.comments.length > 0 && (
                      <div className="space-y-1">
                        {issue.comments.map((c: any) => (
                          <div key={c.id} className="text-xs bg-white p-2 border">
                            <strong>{c.userName}</strong> · {new Date(c.createdAt).toLocaleString()}
                            <p className="mt-1 text-gray-700">{c.message}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add comment */}
                    <div className="flex gap-2">
                      <input className="input-field flex-1 text-sm" placeholder="Add comment..."
                        value={comment} onChange={e => setComment(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addComment(issue.id)} />
                      <button onClick={() => addComment(issue.id)} className="btn-secondary text-sm"><Send size={14} /></button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
