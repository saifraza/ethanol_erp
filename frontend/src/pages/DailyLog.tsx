import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { CheckCircle, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function DailyLog() {
  const [entries, setEntries] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const { user } = useAuth();
  const navigate = useNavigate();

  const load = () => {
    api.get(`/daily-entries?page=${page}&limit=15`).then(r => { setEntries(r.data.entries); setTotal(r.data.total); });
  };
  useEffect(load, [page]);

  const approve = async (id: string) => {
    await api.post(`/daily-entries/${id}/approve`);
    load();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Daily Log</h1>
      <div className="card overflow-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-gray-500">
            <th className="pb-2">Date</th><th>Status</th><th>Prod BL</th><th>Recovery</th><th>Grain Stock</th><th>Steam TPH</th><th>DDGS</th><th>By</th><th></th>
          </tr></thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} className="border-b hover:bg-gray-50">
                <td className="py-2 font-medium">{e.date.split('T')[0]}</td>
                <td><span className={`px-2 py-0.5 text-xs rounded ${e.status === 'APPROVED' ? 'bg-green-100 text-green-700' : e.status === 'SUBMITTED' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{e.status}</span></td>
                <td>{e.productionBL?.toFixed(1) ?? '—'}</td>
                <td>{e.recovery ? (e.recovery * 100).toFixed(2) + '%' : '—'}</td>
                <td>{e.grainClosingStock?.toFixed(0) ?? '—'}</td>
                <td>{e.steamAvgTPH?.toFixed(1) ?? '—'}</td>
                <td>{e.ddgsProduction?.toFixed(1) ?? '—'}</td>
                <td className="text-gray-500">{e.user?.name}</td>
                <td className="flex gap-1">
                  <button onClick={() => navigate(`/daily-entry?date=${e.date.split('T')[0]}`)} className="p-1 text-blue-500 hover:text-blue-700"><Eye size={16} /></button>
                  {e.status === 'SUBMITTED' && (user?.role === 'ADMIN' || user?.role === 'SUPERVISOR') && (
                    <button onClick={() => approve(e.id)} className="p-1 text-green-500 hover:text-green-700"><CheckCircle size={16} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && <p className="text-center text-gray-400 py-8">No entries yet</p>}
        <div className="flex justify-between items-center mt-4 text-sm text-gray-500">
          <span>{total} entries</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary text-xs">Prev</button>
            <span>Page {page}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={entries.length < 15} className="btn-secondary text-xs">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
