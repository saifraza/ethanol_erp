import React, { useState } from 'react';
import api from '../services/api';
import { Download, BarChart3 } from 'lucide-react';

export default function Reports() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    const res = await api.get(`/reports/summary?startDate=${startDate}&endDate=${endDate}`);
    setData(res.data);
    setLoading(false);
  };

  const exportCSV = () => { window.open(`/api/reports/export?startDate=${startDate}&endDate=${endDate}`, '_blank'); };

  const s = data?.summary;
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Reports</h1>
      <div className="card mb-6">
        <div className="flex items-end gap-4">
          <div><label className="block text-sm font-medium mb-1">Start Date</label><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-field" /></div>
          <div><label className="block text-sm font-medium mb-1">End Date</label><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input-field" /></div>
          <button onClick={generate} className="btn-primary flex items-center gap-2" disabled={loading}><BarChart3 size={16} />{loading ? 'Loading...' : 'Generate'}</button>
          {data && <button onClick={exportCSV} className="btn-secondary flex items-center gap-2"><Download size={16} />Export CSV</button>}
        </div>
      </div>

      {s && (
        <div className="card">
          <h3 className="section-title">Summary ({s.totalDays} days)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
            <div><p className="text-gray-500">Total Production</p><p className="text-xl font-bold">{s.totalProduction.toFixed(1)} BL</p></div>
            <div><p className="text-gray-500">Total Production AL</p><p className="text-xl font-bold">{s.totalProductionAL.toFixed(1)} AL</p></div>
            <div><p className="text-gray-500">Avg Recovery</p><p className="text-xl font-bold">{(s.avgRecovery * 100).toFixed(2)}%</p></div>
            <div><p className="text-gray-500">Total Grain Consumed</p><p className="text-xl font-bold">{s.totalGrainConsumed.toFixed(0)} Ton</p></div>
            <div><p className="text-gray-500">Total Steam</p><p className="text-xl font-bold">{s.totalSteam.toFixed(0)} Ton</p></div>
            <div><p className="text-gray-500">Avg Steam TPH</p><p className="text-xl font-bold">{s.avgSteamTPH.toFixed(1)}</p></div>
            <div><p className="text-gray-500">Total DDGS</p><p className="text-xl font-bold">{s.totalDDGS.toFixed(1)} Ton</p></div>
          </div>
        </div>
      )}

      {data?.entries?.length > 0 && (
        <div className="card mt-4 overflow-auto">
          <h3 className="section-title">Daily Data</h3>
          <table className="w-full text-xs">
            <thead><tr className="border-b text-left text-gray-500"><th>Date</th><th>Prod BL</th><th>Prod AL</th><th>Recovery</th><th>Grain Used</th><th>Steam</th><th>DDGS</th></tr></thead>
            <tbody>{data.entries.map((e: any) => (
              <tr key={e.id} className="border-b"><td className="py-1">{e.date.split('T')[0]}</td><td>{e.productionBL?.toFixed(1)}</td><td>{e.productionAL?.toFixed(1)}</td>
                <td>{e.recovery ? (e.recovery * 100).toFixed(2) + '%' : '—'}</td><td>{e.grainConsumed?.toFixed(1)}</td><td>{e.steamTotal?.toFixed(0)}</td><td>{e.ddgsProduction?.toFixed(1)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
