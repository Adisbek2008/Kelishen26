import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money, fmtDateTime } from '../api.js';
import { Icon, TopBar, StatusChip, useLoad, Spinner, Empty, Sheet, useToast, Field } from '../ui.jsx';
import { ResolveForm } from './Deal.jsx';

function Overview() {
  const { data: o, loading } = useLoad(() => api('/admin/overview'));
  if (loading) return <Spinner />;
  const total = Object.values(o.deals).reduce((a, b) => a + b, 0);
  return (
    <div className="stack">
      <div className="stats">
        <div className="card stat"><span className="muted small">Users</span><b>{o.users}</b></div>
        <div className="card stat"><span className="muted small">Deals</span><b>{total}</b></div>
        <div className="card stat"><span className="muted small">Frozen in escrow</span><b>{money(o.escrowCents)}</b></div>
        <div className="card stat"><span className="muted small">Fees</span><b>{money(o.feesCents)}</b></div>
      </div>
      <div className="card list">
        <div className="list-row"><span>Ledger balance (double-entry)</span><b className={o.ledger.ok ? 'green' : 'red'}>{o.ledger.ok ? '✓ balanced' : '✗ BROKEN'}</b></div>
        <div className="list-row"><span>Audit log chain ({o.audit.count})</span><b className={o.audit.ok ? 'green' : 'red'}>{o.audit.ok ? '✓ intact' : `✗ broken at #${o.audit.brokenAt}`}</b></div>
      </div>
      <div className="card list">{Object.entries(o.deals).map(([s, n]) => <div className="list-row" key={s}><StatusChip status={s} /><b>{n}</b></div>)}</div>
    </div>
  );
}

function Disputes() {
  const { data, loading, reload } = useLoad(() => api('/admin/disputes'));
  if (loading) return <Spinner />;
  if (!data.length) return <Empty icon="gavel" title="No open disputes" />;
  return (
    <div className="stack">{data.map((d) => (
      <div key={d.id} className="card">
        <div className="row between"><b>{d.title}</b><b>{money(d.amountCents)}</b></div>
        <p className="small muted mt4">{d.code} · {d.buyer?.name} → {d.seller?.name}</p>
        <Link to={`/deals/${d.id}`} className="link small">Open chat and evidence →</Link>
        <div className="mt12"><ResolveForm deal={d} onDone={reload} /></div>
      </div>))}</div>
  );
}

function Kyc() {
  const toast = useToast();
  const { data, loading, reload } = useLoad(() => api('/admin/kyc'));
  const [view, setView] = useState(null);
  const [note, setNote] = useState('');
  const open = async (id) => setView(await api(`/admin/kyc/${id}`));
  const decide = async (decision) => { await api(`/admin/kyc/${view.id}`, { method: 'POST', body: { decision, ...(note && { note }) } }); setView(null); setNote(''); reload(); toast('Done'); };
  if (loading) return <Spinner />;
  return (
    <>
      {!data.length ? <Empty icon="idcard" title="No applications" text="With KYC_AUTO_APPROVE enabled, applications are approved automatically" /> :
        <div className="stack">{data.map((u) => <button key={u.id} className="card pick-card" onClick={() => open(u.id)}><div className="row between"><b>{u.name}</b><span className="muted small">{u.email}</span></div></button>)}</div>}
      <Sheet open={!!view} onClose={() => setView(null)} title="Identity review">
        {view && <div className="stack">
          <p className="alert alert-orange small">Access to personal data has been recorded in the audit log</p>
          <div className="card list"><div className="list-row"><span className="muted">Full name</span><b>{view.fullName}</b></div><div className="list-row"><span className="muted">Passport</span><b>{view.passportNumber}</b></div><div className="list-row"><span className="muted">Card</span><b>{view.card}</b></div></div>
          {view.fileId && <img className="kyc-img" src={`/api/files/${view.fileId}?inline=1`} alt="Document" />}
          <Field label="Comment (if rejecting)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="row gap8"><button className="btn btn-danger grow" onClick={() => decide('rejected')}>Reject</button><button className="btn btn-green grow" onClick={() => decide('verified')}>Approve</button></div>
        </div>}
      </Sheet>
    </>
  );
}

function SupportInbox() {
  const { data, loading, reload } = useLoad(() => api('/admin/support'));
  const [thread, setThread] = useState(null);
  const [text, setText] = useState('');
  const open = async (id) => setThread({ id, ...(await api(`/admin/support/${id}`)) });
  const reply = async (e) => { e.preventDefault(); await api(`/admin/support/${thread.id}`, { method: 'POST', body: { text } }); setText(''); open(thread.id); reload(); };
  if (loading) return <Spinner />;
  return (
    <>
      {!data.length ? <Empty icon="support" title="No support requests" /> : <div className="stack">{data.map((t) => (
        <button key={t.userId} className="card pick-card" onClick={() => open(t.userId)}>
          <div className="row between"><b>{t.name}</b>{t.needsReply && <span className="chip chip-orange">Needs reply</span>}</div>
          <p className="small muted mt4 ellipsis">{t.lastText}</p></button>))}</div>}
      <Sheet open={!!thread} onClose={() => setThread(null)} title={thread?.user?.name || 'Conversation'}>
        <div className="admin-thread">{thread?.messages.map((m) => <div key={m.id} className={`bubble ${m.senderRole === 'admin' ? 'mine' : ''}`}><p>{m.text}</p>{m.file && <a className="link small" href={`/api/files/${m.file.id}`}>📎 {m.file.name}</a>}<span className="bubble-time">{fmtDateTime(m.at)}</span></div>)}</div>
        <form onSubmit={reply} className="row gap8 mt12"><input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply…" required /><button className="btn btn-primary btn-sm">Send</button></form>
      </Sheet>
    </>
  );
}

function Audit() {
  const { data, loading } = useLoad(() => api('/admin/audit'));
  if (loading) return <Spinner />;
  return <div className="card list audit">{data.map((a) => (
    <div key={a.id} className="list-row"><div><b className="small mono">{a.action}</b><div className="small muted">{a.actor || 'system'} · {fmtDateTime(a.at)}{a.ip ? ` · ${a.ip}` : ''}</div></div><span className="mono tiny muted" title={a.hash}>#{a.id} {a.hash.slice(0, 8)}</span></div>))}</div>;
}

const TABS = [['overview', 'Overview', Overview], ['disputes', 'Disputes', Disputes], ['kyc', 'KYC', Kyc], ['support', 'Support', SupportInbox], ['audit', 'Audit', Audit]];

export default function Admin() {
  const [tab, setTab] = useState('overview');
  const Cmp = TABS.find((t) => t[0] === tab)[2];
  return (
    <div className="page">
      <TopBar title="Administration" />
      <div className="filters mt12">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div className="mt16"><Cmp /></div>
    </div>
  );
}
