import React, { useState } from 'react';
import { Save, Loader2, X, Share2, Check } from 'lucide-react';

interface PreviewField {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
}

interface PreviewSection {
  title: string;
  color: string; // tailwind bg color class like 'bg-red-50'
  fields: PreviewField[];
  columns?: number; // grid cols, default 3
}

interface PreviewModalProps {
  title: string;
  headerColor: string; // tailwind bg class like 'bg-red-600'
  date: string;
  time?: string;
  sections: PreviewSection[];
  extraInfo?: string; // e.g. remark
  onSave: () => Promise<void> | void;
  onClose: () => void;
  saving: boolean;
  whatsappText: string;
}

export default function PreviewModal({
  title, headerColor, date, time, sections, extraInfo,
  onSave, onClose, saving, whatsappText
}: PreviewModalProps) {
  const [saved, setSaved] = useState(false);

  const shareWhatsApp = () => {
    if (navigator.share) {
      navigator.share({ text: whatsappText }).catch(() => {
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappText)}`, '_blank');
      });
    } else {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappText)}`, '_blank');
    }
  };

  // Save first, then share
  const handleSaveAndShare = async () => {
    try {
      await onSave();
      setSaved(true);
      shareWhatsApp();
    } catch { /* onSave handles its own errors */ }
  };

  // Save only
  const handleSaveOnly = async () => {
    try {
      await onSave();
      setSaved(true);
    } catch { /* onSave handles its own errors */ }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={`sticky top-0 ${headerColor} text-white p-4 rounded-t-xl flex items-center justify-between`}>
          <h3 className="font-bold text-lg">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded"><X size={20} /></button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 text-sm">
          <div className="flex justify-between text-gray-600 border-b pb-2">
            <span>Date: <strong>{date}</strong></span>
            {time && <span>Time: <strong>{time || '—'}</strong></span>}
          </div>

          {sections.map((sec, i) => (
            <div key={i}>
              <h4 className="font-semibold text-gray-700 mb-1">{sec.title}</h4>
              <div className={`grid grid-cols-${sec.columns || 3} gap-2`}>
                {sec.fields.map((f, j) => (
                  <div key={j} className={`${sec.color} rounded p-2 text-center`}>
                    <div className="text-xs text-gray-500">{f.label}</div>
                    <div className="font-semibold">{f.value != null && f.value !== '' ? `${f.value}${f.unit || ''}` : '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {extraInfo && <div className="text-gray-600 italic">{extraInfo}</div>}
        </div>

        {/* Footer — Save & Share (primary), Save only (secondary) */}
        <div className="sticky bottom-0 bg-gray-50 p-4 rounded-b-xl border-t space-y-2">
          {saved && (
            <div className="flex items-center justify-center gap-1.5 text-green-600 text-xs font-medium pb-1">
              <Check size={14} /> Saved successfully
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={handleSaveAndShare} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />} Save & Share
            </button>
            <button onClick={handleSaveOnly} disabled={saving}
              className={`flex items-center justify-center gap-2 ${headerColor} text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition`}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
