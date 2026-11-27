import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money, fmtDate } from '../api.js';
import { Icon, StatusChip, TabBar, useLoad, Spinner, Empty } from '../ui.jsx';

const FILTERS = [
  ['all', 'All', () => true],
  ['completed', 'Completed', (d) => d.status === 'completed'],
  ['disputed', 'Disputes', (d) => ['disputed', 'resolved'].includes(d.status)],
  ['cancelled', 'Cancelled', (d) => ['cancelled', 'refunded'].includes(d.status)],
];

export default function History() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const { data, loading } = useLoad(() => api('/deals'));
  const fn = FILTERS.find((f) => f[0] === filter)[2];
  const needle = q.trim().toLowerCase();
  const list = (data || []).filter(fn).filter((d) => !needle || d.title.toLowerCase().includes(needle) || d.code.toLowerCase().includes(needle) || d.counterparty?.name.toLowerCase().includes(needle));
  const groups = {};
  for (const d of list) {
    const k = new Date(d.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
    (groups[k] ||= []).push(d);
  }

  return (
    <>
      <div className="page with-tabs">
        <h1 className="h1 mt8">Deal history</h1>
        <p className="muted">All your deals in one place.</p>
        <div className="search mt16"><Icon name="search" size={18} /><input placeholder="Search deals and people" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="filters mt12">{FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div>
        {loading ? <Spinner /> : list.length === 0 ? <Empty icon="history" title="Nothing found" /> :
          Object.entries(groups).map(([month, items]) => (
            <div key={month} className="mt16">
              <div className="row between small muted mb8"><span className="eyebrow">{month}</span><span>{items.length} {items.length === 1 ? 'deal' : 'deals'}</span></div>
              <div className="stack">
                {items.map((d) => (
                  <Link key={d.id} to={`/deals/${d.id}`} className="card hist-card">
                    <div className="row between"><b>{d.title}</b><b>{money(d.amountCents)}</b></div>
                    <div className="row between small muted mt4"><span>{d.counterparty ? `with ${d.counterparty.name}` : d.code}</span><span>{fmtDate(d.createdAt)}</span></div>
                    <div className="row between mt12"><StatusChip status={d.status} /><Icon name="chevron" size={16} className="muted" /></div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
      </div>
      <TabBar />
    </>
  );
}
