import { useState, useEffect, useCallback } from 'react';
import { FileText, Save, Loader2, Plus, Trash2, ChevronDown, CheckCircle, AlertCircle, RotateCcw, Eye, Download, X } from 'lucide-react';
import api from '../services/api';

interface Template {
  id: string | null;
  docType: string;
  title: string;
  terms: string[];
  footer: string;
  bankDetails: string | null;
  companyInfo: unknown;
  remarks: string | null;
}

const DOC_TYPE_LABELS: Record<string, { label: string; desc: string; color: string }> = {
  CHALLAN: { label: 'Delivery Challan', desc: 'Generated when a truck is dispatched', color: 'bg-blue-500' },
  PURCHASE_ORDER: { label: 'Purchase Order', desc: 'Sent to vendors/suppliers', color: 'bg-orange-500' },
  INVOICE: { label: 'Tax Invoice', desc: 'Sent to buyers/customers', color: 'bg-green-500' },
  RATE_REQUEST: { label: 'Rate Request', desc: 'Sent to transporters for freight quotes', color: 'bg-purple-500' },
  SALE_ORDER: { label: 'Sale Order', desc: 'Created for customer orders', color: 'bg-teal-500' },
};

export default function DocumentTemplates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [editData, setEditData] = useState<Record<string, Template>>({});

  // Preview state
  const [previewDocType, setPreviewDocType] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/document-templates');
      setTemplates(res.data.templates);
      const ed: Record<string, Template> = {};
      res.data.templates.forEach((t: Template) => { ed[t.docType] = { ...t }; });
      setEditData(ed);
    } catch {
      flash('err', 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (docType: string) => {
    const data = editData[docType];
    if (!data) return;
    setSaving(docType);
    try {
      await api.put(`/document-templates/${docType}`, {
        title: data.title,
        terms: data.terms,
        footer: data.footer,
        bankDetails: data.bankDetails,
        remarks: data.remarks,
      });
      flash('ok', `${DOC_TYPE_LABELS[docType]?.label || docType} template saved`);
      load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      flash('err', err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(null);
    }
  };

  const updateField = (docType: string, field: keyof Template, value: unknown) => {
    setEditData(prev => ({
      ...prev,
      [docType]: { ...prev[docType], [field]: value },
    }));
  };

  const updateTerm = (docType: string, index: number, value: string) => {
    setEditData(prev => {
      const terms = [...(prev[docType]?.terms || [])];
      terms[index] = value;
      return { ...prev, [docType]: { ...prev[docType], terms } };
    });
  };

  const addTerm = (docType: string) => {
    setEditData(prev => {
      const terms = [...(prev[docType]?.terms || []), ''];
      return { ...prev, [docType]: { ...prev[docType], terms } };
    });
  };

  const removeTerm = (docType: string, index: number) => {
    setEditData(prev => {
      const terms = [...(prev[docType]?.terms || [])];
      terms.splice(index, 1);
      return { ...prev, [docType]: { ...prev[docType], terms } };
    });
  };

  const resetTemplate = (docType: string) => {
    const original = templates.find(t => t.docType === docType);
    if (original) {
      setEditData(prev => ({ ...prev, [docType]: { ...original } }));
    }
  };

  // Preview with current (unsaved) edits
  const openPreview = async (docType: string) => {
    setPreviewDocType(docType);
    setPreviewLoading(true);
    setPreviewHtml('');
    try {
      const data = editData[docType];
      const res = await api.post(`/document-templates/${docType}/preview`, {
        terms: data?.terms || [],
        footer: data?.footer || '',
        bankDetails: data?.bankDetails || '',
      }, { responseType: 'text' });
      setPreviewHtml(res.data);
    } catch {
      flash('err', 'Failed to load preview');
      setPreviewDocType(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const downloadPreviewPdf = async () => {
    if (!previewDocType) return;
    setDownloadingPdf(true);
    try {
      const res = await api.get(`/document-templates/${previewDocType}/preview-pdf`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${previewDocType.toLowerCase()}-sample.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      flash('err', 'Failed to generate PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-700 to-gray-800 text-white">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileText size={24} /> Document Templates
          </h1>
          <p className="text-gray-300 text-xs mt-1">
            Edit terms & conditions, footer text, and bank details for all auto-generated documents
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm flex items-center gap-2 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.type === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />} {msg.text}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" />
          </div>
        ) : (
          <div className="space-y-3">
            {templates.map(template => {
              const meta = DOC_TYPE_LABELS[template.docType];
              const isExpanded = expanded === template.docType;
              const data = editData[template.docType] || template;

              return (
                <div key={template.docType} className="bg-white rounded-lg border shadow-sm">
                  {/* Header */}
                  <button
                    onClick={() => setExpanded(isExpanded ? null : template.docType)}
                    className="w-full p-4 text-left flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-1.5 h-10 rounded-full ${meta?.color || 'bg-gray-400'}`} />
                      <div>
                        <div className="font-semibold text-gray-900 text-sm">{meta?.label || template.docType}</div>
                        <div className="text-xs text-gray-500">{meta?.desc}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400">{data.terms?.length || 0} terms</span>
                      <ChevronDown size={16} className={`text-gray-400 transition ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {/* Expanded edit form */}
                  {isExpanded && (
                    <div className="border-t bg-gray-50 p-4 space-y-4">
                      {/* Title */}
                      <div>
                        <label className="text-xs font-semibold text-gray-600">Document Title</label>
                        <input
                          value={data.title || ''}
                          onChange={e => updateField(template.docType, 'title', e.target.value)}
                          className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="e.g. DELIVERY CHALLAN"
                        />
                      </div>

                      {/* Terms & Conditions */}
                      <div>
                        <label className="text-xs font-semibold text-gray-600">Terms & Conditions</label>
                        <div className="space-y-1.5 mt-1">
                          {(data.terms || []).map((term, idx) => (
                            <div key={idx} className="flex gap-1.5">
                              <span className="text-xs text-gray-400 mt-2.5 w-5 shrink-0">{idx + 1}.</span>
                              <input
                                value={term}
                                onChange={e => updateTerm(template.docType, idx, e.target.value)}
                                className="flex-1 px-3 py-1.5 border rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                placeholder={`Term ${idx + 1}`}
                              />
                              <button
                                onClick={() => removeTerm(template.docType, idx)}
                                className="text-red-400 hover:text-red-600 shrink-0"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => addTerm(template.docType)}
                            className="text-xs text-blue-600 font-medium hover:underline flex items-center gap-1 mt-1"
                          >
                            <Plus size={12} /> Add term
                          </button>
                        </div>
                      </div>

                      {/* Footer */}
                      <div>
                        <label className="text-xs font-semibold text-gray-600">Footer Text</label>
                        <input
                          value={data.footer || ''}
                          onChange={e => updateField(template.docType, 'footer', e.target.value)}
                          className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Footer shown at bottom of document"
                        />
                      </div>

                      {/* Bank Details (for Invoice) */}
                      {(template.docType === 'INVOICE' || data.bankDetails) && (
                        <div>
                          <label className="text-xs font-semibold text-gray-600">Bank Details</label>
                          <textarea
                            value={data.bankDetails || ''}
                            onChange={e => updateField(template.docType, 'bankDetails', e.target.value)}
                            className="w-full mt-1 px-3 py-2 border rounded-lg text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            rows={2}
                            placeholder="Bank: ... | A/c: ... | IFSC: ..."
                          />
                        </div>
                      )}

                      {/* Default Remarks */}
                      <div>
                        <label className="text-xs font-semibold text-gray-600">Default Remarks</label>
                        <input
                          value={data.remarks || ''}
                          onChange={e => updateField(template.docType, 'remarks', e.target.value)}
                          className="w-full mt-1 px-3 py-2 border rounded-lg text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Optional default remarks"
                        />
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 pt-2 border-t">
                        <button
                          onClick={() => save(template.docType)}
                          disabled={!!saving}
                          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                        >
                          {saving === template.docType ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          Save Template
                        </button>
                        <button
                          onClick={() => openPreview(template.docType)}
                          className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 flex items-center gap-2"
                        >
                          <Eye size={14} /> Preview
                        </button>
                        <button
                          onClick={() => resetTemplate(template.docType)}
                          className="px-4 py-2 text-gray-600 text-sm font-medium rounded-lg border hover:bg-gray-50 flex items-center gap-2"
                        >
                          <RotateCcw size={14} /> Reset
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewDocType && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50 rounded-t-lg">
              <div>
                <h3 className="font-semibold text-gray-900 text-sm">
                  {DOC_TYPE_LABELS[previewDocType]?.label || previewDocType} Preview
                </h3>
                <p className="text-[10px] text-gray-500">Sample document with your current template settings</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={downloadPreviewPdf}
                  disabled={downloadingPdf || previewLoading}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {downloadingPdf ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  Download PDF
                </button>
                <button
                  onClick={() => { setPreviewDocType(null); setPreviewHtml(''); }}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body — iframe */}
            <div className="flex-1 overflow-hidden bg-gray-200">
              {previewLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 size={32} className="animate-spin text-gray-400" />
                </div>
              ) : (
                <iframe
                  srcDoc={previewHtml}
                  className="w-full h-full border-0"
                  title="Document Preview"
                  sandbox="allow-same-origin"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
