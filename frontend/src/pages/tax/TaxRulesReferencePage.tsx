import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';

// ============ Types ============

interface ComplianceConfig {
  id?: string;
  legalName: string;
  pan: string;
  tan: string;
  gstin: string;
  cin: string | null;
  udyamNo: string | null;
  registeredState: string;
  registeredStateName: string | null;
  taxRegime: string;
  eInvoiceEnabled: boolean;
  eInvoiceThresholdCr: number;
  eWayBillMinAmount: number;
  lutNumber: string | null;
  lutValidFrom: string | null;
  lutValidTill: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface FiscalYear {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  isClosed: boolean;
}

interface InvoiceSeriesRow {
  id: string;
  docType: string;
  prefix: string;
  nextNumber: number;
  width: number;
  isActive: boolean;
}

interface GstRateRow {
  id: string;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  isExempt: boolean;
  isOutsideGst: boolean;
  conditionNote: string | null;
  effectiveFrom: string;
  effectiveTill: string | null;
}

interface HsnRow {
  id: string;
  code: string;
  description: string;
  uqc: string;
  category: string;
  isActive: boolean;
  rates: GstRateRow[];
}

interface TdsSectionRow {
  id: string;
  code: string;
  newSection: string;
  oldSection: string | null;
  nature: string;
  rateIndividual: number;
  rateOthers: number;
  thresholdSingle: number;
  thresholdAggregate: number;
  panMissingRate: number;
  nonFilerRate: number;
  effectiveFrom: string;
  isActive: boolean;
}

interface TcsSectionRow {
  id: string;
  code: string;
  nature: string;
  rate: number;
  threshold: number;
  effectiveFrom: string;
  isActive: boolean;
}

interface Explanation {
  id: string;
  ruleKey: string;
  title: string;
  plainEnglish: string;
  whatErpDoes: string;
  whatUserDoes: string;
  sourceLink: string | null;
  category: string;
  sortOrder: number;
  updatedAt: string | null;
}

interface Summary {
  config: ComplianceConfig | null;
  currentFy: FiscalYear | null;
  invoiceSeries: InvoiceSeriesRow[];
  hsn: HsnRow[];
  tdsSections: TdsSectionRow[];
  tcsSections: TcsSectionRow[];
  explanations: Explanation[];
}

// ============ Helpers ============

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return '--';
  try {
    return new Date(d).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '--';
  }
};

const fmtDateTime = (d: string | null | undefined): string => {
  if (!d) return '--';
  try {
    return new Date(d).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: true,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '--';
  }
};

const fmtAmount = (n: number): string => {
  if (!n && n !== 0) return '--';
  return n.toLocaleString('en-IN');
};

const currentRate = (rates: GstRateRow[]): GstRateRow | null => {
  if (!rates?.length) return null;
  const today = new Date();
  const active = rates.filter((r) => {
    const from = new Date(r.effectiveFrom);
    const till = r.effectiveTill ? new Date(r.effectiveTill) : null;
    return from <= today && (!till || till >= today);
  });
  return active[0] || rates[0];
};

// Hardcoded compliance calendar — reference info from compliance-tax-system.md §6
const COMPLIANCE_CALENDAR: { day: string; obligation: string; category: string }[] = [
  { day: '7th', obligation: 'TDS / TCS deposit (previous month)', category: 'DIRECT_TAX' },
  { day: '11th', obligation: 'GSTR-1 filing', category: 'GST' },
  { day: '14th', obligation: 'GSTR-2B available — begin reconciliation', category: 'GST' },
  { day: '15th', obligation: 'PF, ESI deposit (previous month)', category: 'PAYROLL' },
  { day: '15-Jun / 15-Sep / 15-Dec / 15-Mar', obligation: 'Advance tax instalments (15% / 45% / 75% / 100%)', category: 'DIRECT_TAX' },
  { day: '20th', obligation: 'GSTR-3B + GST payment', category: 'GST' },
  { day: '25th', obligation: 'Professional Tax (state-dependent)', category: 'PAYROLL' },
  { day: 'End of month after quarter', obligation: 'TDS return (26Q / 24Q / 27EQ)', category: 'DIRECT_TAX' },
  { day: '30-Jun', obligation: 'DPT-3 (return of deposits)', category: 'ROC' },
  { day: '30-Sep', obligation: 'DIR-3 KYC; Tax audit (3CA / 3CD)', category: 'ROC' },
  { day: '31-Oct', obligation: 'ITR-6 (audited companies)', category: 'DIRECT_TAX' },
  { day: '25-Oct / 25-Apr', obligation: 'ITC-04 (job-work half-yearly)', category: 'GST' },
  { day: '30-Nov', obligation: 'ITC cut-off for previous FY', category: 'GST' },
  { day: '31-Dec', obligation: 'GSTR-9 + GSTR-9C annual returns', category: 'GST' },
  { day: '31-Mar', obligation: 'FY close; LUT renewal; MSME aging cut; actuarial valuation', category: 'OTHER' },
];

// ============ Sections config ============

const SECTIONS: { id: string; title: string }[] = [
  { id: 'overview', title: 'Overview' },
  { id: 'company', title: 'Company Identity' },
  { id: 'direct', title: 'Direct Tax (TDS / TCS)' },
  { id: 'gst', title: 'GST & HSN' },
  { id: 'payroll', title: 'Payroll' },
  { id: 'other', title: 'Other Statutory' },
  { id: 'distillery', title: 'Distillery-Specific' },
  { id: 'calendar', title: 'Compliance Calendar' },
  { id: 'changelog', title: 'Change Log' },
];

// ============ Component ============

export default function TaxRulesReferencePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeSection, setActiveSection] = useState<string>('overview');
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get<Summary>('/tax/rules/summary');
      setSummary(res.data);
    } catch (err) {
      console.error('Failed to fetch tax rules summary:', err);
      setError('Unable to load tax rules. Run POST /api/tax/seed if this is a fresh install.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Scroll spy via IntersectionObserver
  useEffect(() => {
    if (!summary) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0 }
    );
    SECTIONS.forEach((s) => {
      const el = sectionRefs.current[s.id];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [summary]);

  const scrollToSection = (id: string) => {
    const el = sectionRefs.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Filtered explanations by category + search
  const explanationsByCategory = useMemo(() => {
    const map: Record<string, Explanation[]> = {};
    if (!summary?.explanations) return map;
    const q = search.trim().toLowerCase();
    summary.explanations.forEach((e) => {
      if (q && !(
        e.title.toLowerCase().includes(q) ||
        e.plainEnglish.toLowerCase().includes(q) ||
        e.whatErpDoes.toLowerCase().includes(q) ||
        e.whatUserDoes.toLowerCase().includes(q)
      )) return;
      if (!map[e.category]) map[e.category] = [];
      map[e.category].push(e);
    });
    Object.keys(map).forEach((k) => map[k].sort((a, b) => a.sortOrder - b.sortOrder));
    return map;
  }, [summary, search]);

  // Alerts strip
  const alerts = useMemo(() => {
    if (!summary?.config) return [];
    const list: { level: 'GREEN' | 'YELLOW' | 'RED'; text: string }[] = [];
    const cfg = summary.config;
    const today = new Date();

    if (cfg.lutValidTill) {
      const till = new Date(cfg.lutValidTill);
      if (till >= today) {
        list.push({ level: 'GREEN', text: `LUT valid till ${fmtDate(cfg.lutValidTill)}` });
      } else {
        list.push({ level: 'RED', text: `LUT EXPIRED on ${fmtDate(cfg.lutValidTill)} — export invoices blocked` });
      }
    } else {
      list.push({ level: 'YELLOW', text: 'LUT not configured — export invoices will charge IGST' });
    }

    if (cfg.eInvoiceEnabled) {
      list.push({ level: 'GREEN', text: `E-invoice enabled (AATO threshold ₹${cfg.eInvoiceThresholdCr} Cr)` });
    } else {
      list.push({ level: 'YELLOW', text: 'E-invoice disabled — enable in config if AATO > ₹5 Cr' });
    }

    if (summary.currentFy) {
      list.push({ level: 'GREEN', text: `Current FY: ${summary.currentFy.code}` });
    } else {
      list.push({ level: 'RED', text: 'No current Fiscal Year set' });
    }

    if (!summary.hsn?.length) list.push({ level: 'RED', text: 'HSN master empty — run seed' });
    if (!summary.tdsSections?.length) list.push({ level: 'RED', text: 'TDS sections empty — run seed' });

    return list;
  }, [summary]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading tax rules reference...</div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="bg-white border border-slate-300 p-6">
          <div className="text-xs text-red-600 uppercase tracking-widest font-bold mb-2">Error</div>
          <div className="text-sm text-slate-700">{error || 'No data'}</div>
          <button
            onClick={fetchData}
            className="mt-4 px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const cfg = summary.config;

  return (
    <div className="min-h-screen bg-slate-50">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-full { margin: 0 !important; padding: 0 !important; }
        }
      `}</style>

      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between no-print">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Tax Rules Reference</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">
              Indian Tax System — MSPIL Distillery ERP
            </span>
            {cfg?.updatedAt && (
              <>
                <span className="text-[10px] text-slate-400">|</span>
                <span className="text-[10px] text-slate-400">
                  Updated {fmtDateTime(cfg.updatedAt)}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a rule..."
              className="bg-slate-700 text-white placeholder-slate-400 border border-slate-600 px-2 py-1 text-[11px] w-64 focus:outline-none focus:border-slate-400"
            />
            <button
              onClick={() => window.print()}
              className="px-3 py-1 bg-white/10 text-white text-[11px] font-medium hover:bg-white/20"
            >
              Print
            </button>
          </div>
        </div>

        {/* Alerts strip */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-2 flex flex-wrap gap-2 no-print">
          {alerts.map((a, i) => {
            const color =
              a.level === 'GREEN'
                ? 'bg-green-50 border-green-400 text-green-800'
                : a.level === 'YELLOW'
                ? 'bg-amber-50 border-amber-400 text-amber-800'
                : 'bg-red-50 border-red-400 text-red-800';
            return (
              <div
                key={i}
                className={`text-[10px] uppercase tracking-widest font-bold px-2 py-1 border-l-4 ${color}`}
              >
                [{a.level}] {a.text}
              </div>
            );
          })}
        </div>

        {/* Two-column layout */}
        <div className="flex -mx-3 md:-mx-6 border-x border-b border-slate-300">
          {/* Sticky left nav */}
          <div className="w-56 bg-slate-100 border-r border-slate-300 p-3 no-print sticky top-0 self-start" style={{ maxHeight: '100vh', overflowY: 'auto' }}>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Sections</div>
            <nav className="flex flex-col gap-0">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => scrollToSection(s.id)}
                  className={`text-left text-[11px] px-2 py-1.5 border-l-2 ${
                    activeSection === s.id
                      ? 'bg-white text-slate-800 border-l-blue-600 font-bold'
                      : 'text-slate-600 border-l-transparent hover:bg-white/60'
                  }`}
                >
                  {s.title}
                </button>
              ))}
            </nav>
          </div>

          {/* Main content */}
          <div className="flex-1 bg-white">
            {/* 1. Overview */}
            <section
              ref={(el) => { sectionRefs.current['overview'] = el; }}
              id="overview"
              className="px-6 py-6 border-b border-slate-200"
            >
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-800 mb-3">
                Overview
              </h2>
              <p className="text-xs text-slate-700 leading-relaxed mb-2">
                This page is the single source of truth for every tax rule enforced by the MSPIL
                Distillery ERP. Every figure on this page is read live from the compliance master
                data — if a rate or section is updated in the admin pages, this page reflects it
                instantly.
              </p>
              <p className="text-xs text-slate-700 leading-relaxed">
                If the ERP blocks a transaction (e.g., an invoice rejection), the error message will
                reference a rule on this page. Operators, accounts staff, management, and auditors
                should all read the same rules from this page.
              </p>
            </section>

            {/* 2. Company Identity */}
            <section
              ref={(el) => { sectionRefs.current['company'] = el; }}
              id="company"
              className="px-6 py-6 border-b border-slate-200"
            >
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-800 mb-3">
                Company Identity
              </h2>
              {cfg ? (
                <table className="w-full text-xs border border-slate-300">
                  <tbody>
                    {[
                      ['Legal Name', cfg.legalName || '--'],
                      ['GSTIN', cfg.gstin || '--'],
                      ['PAN', cfg.pan || '--'],
                      ['TAN', cfg.tan || '--'],
                      ['CIN', cfg.cin || '--'],
                      ['Udyam No', cfg.udyamNo || '--'],
                      ['Registered State', `${cfg.registeredState || '--'} ${cfg.registeredStateName ? '— ' + cfg.registeredStateName : ''}`],
                      ['Tax Regime', cfg.taxRegime || 'NORMAL'],
                      ['E-Invoice', cfg.eInvoiceEnabled ? `Enabled (≥ ₹${cfg.eInvoiceThresholdCr} Cr AATO)` : 'Disabled'],
                      ['E-Way Bill min', `₹${fmtAmount(cfg.eWayBillMinAmount)}`],
                      ['LUT No', cfg.lutNumber || '--'],
                      ['LUT Valid From', fmtDate(cfg.lutValidFrom)],
                      ['LUT Valid Till', fmtDate(cfg.lutValidTill)],
                    ].map(([label, value]) => (
                      <tr key={label} className="border-b border-slate-100 even:bg-slate-50/70">
                        <td className="px-3 py-1.5 border-r border-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-widest w-48">
                          {label}
                        </td>
                        <td className="px-3 py-1.5 text-slate-800 font-mono tabular-nums">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-xs text-slate-400 uppercase tracking-widest">
                  Compliance config not set — visit{' '}
                  <Link to="/admin/tax/config" className="text-blue-600 hover:underline">
                    /admin/tax/config
                  </Link>
                </div>
              )}
            </section>

            {/* 3. Direct Tax */}
            <section
              ref={(el) => { sectionRefs.current['direct'] = el; }}
              id="direct"
              className="px-6 py-6 border-b border-slate-200"
            >
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-800 mb-3">
                Direct Tax — TDS / TCS
              </h2>

              {/* Explanations */}
              {(explanationsByCategory['DIRECT_TAX'] || []).map((e) => (
                <ExplanationCard key={e.id} exp={e} />
              ))}

              <div className="mt-4 text-[11px] text-slate-500">
                Full TDS rate & threshold table is managed in{' '}
                <a href="/admin/tax/tds-sections" className="text-blue-700 hover:underline font-medium">TDS Sections</a>.
                TCS lives in{' '}
                <a href="/admin/tax/tcs-sections" className="text-blue-700 hover:underline font-medium">TCS Sections</a>.
              </div>
            </section>

            {/* 4. GST & HSN */}
            <section
              ref={(el) => { sectionRefs.current['gst'] = el; }}
              id="gst"
              className="px-6 py-6 border-b border-slate-200"
            >
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-800 mb-3">
                GST & HSN
              </h2>

              {(explanationsByCategory['GST'] || []).map((e) => (
                <ExplanationCard key={e.id} exp={e} />
              ))}

              <div className="mt-4 text-[11px] text-slate-500">
                Full HSN codes, rates, and effective-dated history are managed in{' '}
                <a href="/admin/tax/hsn" className="text-blue-700 hover:underline font-medium">HSN Master</a>.
                Document numbering series is atomic and not user-editable — see{' '}
                <a href="/admin/tax/invoice-series" className="text-blue-700 hover:underline font-medium">Sell Invoices</a>{' '}
                for issued invoices.
              </div>
            </section>

            {/* 5. Payroll */}
            <section
              ref={(el) => { sectionRefs.current['payroll'] = el; }}
              id="payroll"
              className="px-6 py-6 border-b border-slate-200"
            >
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-800 mb-3">
                Payroll
              </h2>
              {(explanationsByCategory['PAYROLL'] || []).map((e) => (
                <ExplanationCard key={e.id} exp={e} />
              ))}
              {!explanationsByCategory['PAYROLL']?.length && (
                <div className="text-xs text-slate-500 italic">
                  PF (12% + 12%), ESI (0.75% + 3.25% up to ₹21K), Professional Tax, LWF, Gratuity, and Bonus rules will appear here as explanations are added. Payroll enforcement is scheduled for Phase 2.
                </div>
              )}
            </section>

            {/* 6. Other Statutory */}
            <section
              ref={(el) => { sectionRefs.current['other'] = el; }}
              id="other"
              className="px-6 py-6 border-b border-slate-200"
            >
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-800 mb-3">
                Other Statutory (ROC, MSME, Pollution)
              </h2>
              {(explanationsByCategory['OTHER'] || explanationsByCategory['ROC'] || []).map((e) => (
                <ExplanationCard key={e.id} exp={e} />
              ))}
            </section>

            {/* 7. Distillery-Specific */}
            <section
              ref={(el) => { sectionRefs.current['distillery'] = el; }}
              id="distillery"
              className="px-6 py-6 border-b border-slate-200"
            >
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-800 mb-3">
                Distillery-Specific
              </h2>
              {(explanationsByCategory['DISTILLERY'] || []).map((e) => (
                <ExplanationCard key={e.id} exp={e} />
              ))}
              {!explanationsByCategory['DISTILLERY']?.length && (
                <div className="text-xs text-slate-500 italic">
                  State excise permits (PD-25 / PD-26), molasses control order, OMC ethanol allocation rules, and interest subvention reconciliation rules will appear here.
                </div>
              )}
            </section>

            {/* 8. Compliance Calendar */}
            <section
              ref={(el) => { sectionRefs.current['calendar'] = el; }}
              id="calendar"
              className="px-6 py-6 border-b border-slate-200"
            >
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-800 mb-3">
                Compliance Calendar
              </h2>
              <table className="w-full text-xs border border-slate-300">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-56">Due Date</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Obligation</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPLIANCE_CALENDAR.map((row, i) => (
                    <tr key={i} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 font-mono tabular-nums text-slate-800 border-r border-slate-100">{row.day}</td>
                      <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">{row.obligation}</td>
                      <td className="px-3 py-1.5 text-[10px] text-slate-500 uppercase tracking-widest">{row.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* 9. Change Log */}
            <section
              ref={(el) => { sectionRefs.current['changelog'] = el; }}
              id="changelog"
              className="px-6 py-6"
            >
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-800 mb-3">
                Change Log
              </h2>
              <p className="text-xs text-slate-700 mb-3">
                Every change to a tax rule, HSN rate, TDS section, or compliance config is recorded
                in an immutable audit trail.
              </p>
              <Link
                to="/admin/tax/audit"
                className="inline-block px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 no-print"
              >
                Open Audit Log →
              </Link>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Sub-component ============

function ExplanationCard({ exp }: { exp: Explanation }) {
  return (
    <div className="border border-slate-300 bg-slate-50/50 p-3 mb-3">
      <div className="flex items-start justify-between mb-1">
        <div className="text-[11px] font-bold uppercase tracking-widest text-slate-800">
          {exp.title}
        </div>
        {exp.sourceLink && (
          <a
            href={exp.sourceLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-blue-600 hover:underline no-print"
          >
            Source ↗
          </a>
        )}
      </div>
      <div className="text-xs text-slate-700 mb-2 leading-relaxed">{exp.plainEnglish}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="bg-white border-l-4 border-l-blue-500 px-3 py-2">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
            What the ERP does
          </div>
          <div className="text-[11px] text-slate-700 leading-relaxed">{exp.whatErpDoes}</div>
        </div>
        <div className="bg-white border-l-4 border-l-amber-500 px-3 py-2">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
            What the user must do
          </div>
          <div className="text-[11px] text-slate-700 leading-relaxed">{exp.whatUserDoes}</div>
        </div>
      </div>
    </div>
  );
}
