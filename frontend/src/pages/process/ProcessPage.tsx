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

export default function ProcessPage({ title, icon, description, flow, color, children }: ProcessPageProps) {
  return (
    <div className="max-w-4xl mx-auto">
      <div className={`rounded-lg p-5 mb-6 text-white ${color}`}>
        <div className="flex items-center gap-3 mb-2">
          {icon}
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>
        <p className="text-sm opacity-90">{description}</p>
        {flow && (
          <div className="flex items-center gap-2 mt-3 text-sm opacity-80">
            <span className="bg-white/20 px-2 py-0.5 rounded">{flow.from}</span>
            <ArrowRight size={14} />
            <span className="bg-white/20 px-2 py-0.5 rounded">{flow.to}</span>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export function InputCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card mb-4">
      <h3 className="section-title">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function Field({ label, name, value, onChange, auto, unit, placeholder, type }: any) {
  const inputType = type || (name === 'date' ? 'date' : 'number');
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-gray-600 w-52 shrink-0">{label}{unit && <span className="text-xs text-gray-400 ml-1">({unit})</span>}</label>
      {auto ? (
        <div className="input-auto flex-1">{value != null && value !== '' ? (typeof value === 'number' ? value.toFixed(2) : value) : '—'}</div>
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
          className="input-field flex-1"
          step="any"
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
