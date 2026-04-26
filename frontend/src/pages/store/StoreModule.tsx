/**
 * Store Module — unified page combining Store Purchase Orders (deals) and
 * Store Receipts (GRNs) under one URL with tabs.
 *
 * Replaces the old /inventory/store-deals + /store/receipts split. Both
 * routes now mount this wrapper, and the tab is controlled by the URL
 * `?tab=` query param so refresh / back-button preserves state.
 *
 * - Tab 'pos'  → Store Purchase Orders (StoreDeals component)
 * - Tab 'grns' → Store Receipts / GRNs (StoreReceipts component)
 *
 * See .claude/skills/grn-split-auto-vs-store.md for the broader split.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import StoreDeals from '../inventory/StoreDeals';
import StoreReceipts from './StoreReceipts';

type Tab = 'pos' | 'grns';

export default function StoreModule() {
  const location = useLocation();
  const navigate = useNavigate();

  const initialTab: Tab = useMemo(() => {
    const t = new URLSearchParams(location.search).get('tab');
    if (t === 'pos' || t === 'grns') return t;
    // Default to Purchase Orders — that's the post-award workflow entry point.
    return 'pos';
  }, [location.search]);

  const [tab, setTab] = useState<Tab>(initialTab);

  // Keep URL in sync with tab
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('tab') !== tab) {
      params.set('tab', tab);
      navigate(`/store/receipts?${params.toString()}`, { replace: true });
    }
  }, [tab, location.search, navigate]);

  return (
    <div className="relative">
      {/* Sticky tab switcher overlaid on the child page's own toolbar */}
      <div className="sticky top-0 z-30 bg-slate-900 border-b border-slate-700 flex items-center justify-end px-4 py-1">
        <TabButton active={tab === 'pos'} onClick={() => setTab('pos')}>
          Purchase Orders
        </TabButton>
        <TabButton active={tab === 'grns'} onClick={() => setTab('grns')}>
          Receipts (GRN)
        </TabButton>
      </div>

      {/* Tab panels — mount both so state is preserved when switching. */}
      <div style={{ display: tab === 'pos' ? 'block' : 'none' }}>
        <StoreDeals />
      </div>
      <div style={{ display: tab === 'grns' ? 'block' : 'none' }}>
        <StoreReceipts />
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest border-b-2 ${
        active
          ? 'border-blue-400 text-white bg-slate-700'
          : 'border-transparent text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}
