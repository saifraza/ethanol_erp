import React from 'react';
import { ArrowRight } from 'lucide-react';

interface ProcessStep {
  label?: string;
  from: string;
  to: string;
}

interface ProcessPageProps {
  title: string;
  icon: React.ReactNode;
  description: string;
  flow?: ProcessStep;
  color: string;
  children: React.ReactNode;
}

export default function ProcessPage({ title, description, flow, children }: ProcessPageProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* SAP-style dark toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">{title}</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">{description}</span>
          </div>
          {flow && (
            <div className="hidden md:flex items-center gap-2 text-[10px] text-slate-400">
              <span className="px-1.5 py-0.5 border border-slate-600">{flow.from}</span>
              <ArrowRight size={10} />
              <span className="px-1.5 py-0.5 border border-slate-600">{flow.to}</span>
            </div>
          )}
        </div>
        <div className="mt-4 space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
}

export function InputCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-300 overflow-hidden">
      <div className="bg-slate-100 px-4 py-2 border-b border-slate-300">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{title}</h3>
      </div>
      <div className="bg-white p-4 space-y-3">{children}</div>
    </div>
  );
}

export function Field({ label, name, value, onChange, auto, unit, placeholder, type }: any) {
  const inputType = type || (name === 'date' ? 'date' : 'number');
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2">
      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-full md:w-52 md:shrink-0">
        {label}{unit && <span className="text-[10px] text-slate-400 ml-1 normal-case">({unit})</span>}
      </label>
      {auto ? (
        <div className="input-auto w-full md:flex-1">{value != null && value !== '' ? (typeof value === 'number' ? value.toFixed(2) : value) : '--'}</div>
      ) : (
        <input
          type={inputType}
          value={value ?? ''}
          onChange={e => {
            if (inputType === 'number') {
              onChange(name, e.target.value === '' ? null : parseFloat(e.target.value));
            } else {
              onChange(name, e.target.value);
            }
          }}
          className="input-field w-full md:flex-1"
          step="any"
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
