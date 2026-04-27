import { Outlet, NavLink } from 'react-router-dom';

const tabs = [
  { to: '/hr/payroll', end: true, label: 'Runs' },
  { to: '/hr/payroll/pay-today', label: 'Pay Today' },
  { to: '/hr/payroll/import', label: 'Import Sheet' },
  { to: '/hr/payroll/declarations', label: 'Tax Declarations' },
  { to: '/hr/payroll/tds', label: 'TDS Report' },
  { to: '/hr/payroll/form-16', label: 'Form 16' },
];

export default function PayrollHub() {
  return (
    <>
      {/* Shared tab strip — replaces 6 separate sidebar entries */}
      <div className="bg-slate-900 flex overflow-x-auto border-b border-slate-700 sticky top-0 z-30">
        {tabs.map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest border-r border-slate-700 whitespace-nowrap ${
                isActive
                  ? 'bg-slate-50 text-slate-900 border-b-2 border-b-blue-600'
                  : 'text-slate-300 hover:bg-slate-800'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </>
  );
}
