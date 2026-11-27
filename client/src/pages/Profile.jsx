import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, money, fmtDate, fmtDateTime, setCsrf, copyText } from '../api.js';
import { useAuth } from '../App.jsx';
import { Icon, Avatar, Rating, TabBar, TopBar, Sheet, Field, useLoad, Spinner, Empty, useToast } from '../ui.jsx';

const fmtCard = (v) => v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
const fmtExp = (v) => { const d = v.replace(/\D/g, '').slice(0, 4); return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; };

function Row({ to, icon, title, sub, onClick }) {
  const inner = <><span className="row-icon"><Icon name={icon} size={19} /></span><div className="grow"><b>{title}</b>{sub && <div className="small">{sub}</div>}</div><Icon name="chevron" size={18} className="muted" /></>;
  return to ? <Link to={to} className="settings-row">{inner}</Link> : <button className="settings-row" onClick={onClick}>{inner}</button>;
}

export function Profile() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [cardOpen, setCardOpen] = useState(false);
  const [c, setC] = useState({ number: '', exp: '', cvc: '' });
  const [err, setErr] = useState('');

  const logout = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setCsrf(''); setUser(null); nav('/welcome'); };
  const invite = async () => { const url = location.origin + '/welcome'; (await copyText(url)) ? toast('Invite link copied') : toast('Copy it manually: ' + url, 'err'); };
  const saveCard = async (e) => {
    e.preventDefault(); setErr('');
    try { const d = await api('/kyc/card', { method: 'PUT', body: { card: c } }); setUser(d.user); setCardOpen(false); setC({ number: '', exp: '', cvc: '' }); toast('Card updated'); }
    catch (ex) { setErr(ex.message); }
  };

  return (
    <>
      <div className="page with-tabs">
        <div className="row between mt8"><h1 className="h1">Profile</h1><span className="eyebrow">YOUR ACCOUNT</span></div>
        <div className="center-col mt16">
          <div className="avatar-wrap"><Avatar name={user.name} size={84} />{user.kycStatus === 'verified' && <span className="verified-pill"><Icon name="check" size={11} /> Verified</span>}</div>
          <h2 className="h2 mt16">{user.name}</h2>
          <p className="small"><Rating rating={user.rating} /> <span className="muted">· {user.completedDeals} completed deal{user.completedDeals === 1 ? '' : 's'}</span></p>
        </div>

        <p className="eyebrow mt24 mb8">PAYMENT METHOD</p>
        <div className="card row gap12">
          <span className="bank-card"><Icon name="card" size={18} /><small>{user.card?.brand || ''}</small></span>
          <div className="grow"><b>Bank card</b><div className="muted">{user.card ? `•••• ${user.card.last4}` : 'not linked'}</div></div>
          {user.card ? <button className="btn btn-sm btn-soft" onClick={() => setCardOpen(true)}>Change</button> : <Link className="btn btn-sm btn-soft" to="/verify">Add</Link>}
        </div>
        <Link to="/wallet" className="card row gap12 mt8"><span className="row-icon"><Icon name="wallet" size={19} /></span><div className="grow"><b>Balance & transactions</b><div className="muted small">Available {money(user.balanceCents)}</div></div><Icon name="chevron" size={18} className="muted" /></Link>

        <p className="eyebrow mt24 mb8">ACCOUNT SETTINGS</p>
        <div className="card settings">
          <Row to="/verify" icon="idcard" title="Personal & passport details" sub={user.kycStatus === 'verified' ? <span className="green"><Icon name="check" size={12} /> Verified</span> : user.kycStatus === 'pending' ? <span className="orange">Under review</span> : <span className="red">Not verified</span>} />
          <Row to="/notifications" icon="bell" title="Notifications" />
          <Row to="/security" icon="lock" title="Security & sessions" />
          <Row icon="invite" title="Invite friends" onClick={invite} />
          <Row to={`/users/${user.id}`} icon="star" title="My reviews" />
          {user.role === 'admin' && <Row to="/admin" icon="gavel" title="Admin panel" />}
        </div>
        <button className="card logout mt16" onClick={logout}><Icon name="logout" size={18} /> Sign out</button>
      </div>
      <TabBar />
      <Sheet open={cardOpen} onClose={() => setCardOpen(false)} title="New card">
        <form onSubmit={saveCard} className="stack" autoComplete="off">
          <Field label="Card number"><input className="input" inputMode="numeric" autoComplete="cc-number" value={c.number} onChange={(e) => setC({ ...c, number: fmtCard(e.target.value) })} required /></Field>
          <div className="split"><Field label="Expiry"><input className="input" placeholder="MM/YY" value={c.exp} onChange={(e) => setC({ ...c, exp: fmtExp(e.target.value) })} required /></Field>
            <Field label="CVV"><input className="input" type="password" inputMode="numeric" maxLength={4} value={c.cvc} onChange={(e) => setC({ ...c, cvc: e.target.value.replace(/\D/g, '') })} required /></Field></div>
          {err && <div className="alert alert-red">{err}</div>}
          <button className="btn btn-primary">Save</button>
        </form>
      </Sheet>
    </>
  );
}

export function UserProfile() {
  const { id } = useParams();
  const { data: u, loading, error } = useLoad(() => api(`/users/${id}`), [id]);
  if (loading) return <div className="page"><Spinner /></div>;
  if (error) return <div className="page"><TopBar title="Profile" /><Empty title="Not found" /></div>;
  return (
    <div className="page">
      <TopBar title="User profile" />
      <div className="center-col mt16">
        <div className="avatar-wrap"><Avatar name={u.name} size={76} />{u.verified && <span className="verified-pill"><Icon name="check" size={11} /> Verified</span>}</div>
        <h2 className="h2 mt16">{u.name}</h2>
        <p className="small"><Rating rating={u.rating} count={u.reviews} /> <span className="muted">· {u.completedDeals} completed deal{u.completedDeals === 1 ? '' : 's'}</span></p>
        <p className="muted small">On Kelishen since {fmtDate(u.memberSince)}</p>
      </div>
      <p className="eyebrow mt24 mb8">REVIEWS</p>
      {u.reviewList.length === 0 ? <Empty icon="star" title="No reviews yet" /> : (
        <div className="stack">{u.reviewList.map((r, i) => (
          <div key={i} className="card"><div className="row between"><b>{r.author}</b><span className="stars-static">{'★'.repeat(r.rating)}<span className="muted">{'★'.repeat(5 - r.rating)}</span></span></div>
            {r.comment && <p className="mt8">{r.comment}</p>}<p className="small muted mt4">{r.deal} · {fmtDate(r.at)}</p></div>))}</div>
      )}
    </div>
  );
}

export function Notifications() {
  const { user, setUser, refresh } = useAuth();
  const { data, loading } = useLoad(() => api('/notifications').then(async (n) => { await api('/notifications/read', { method: 'POST' }); refresh(); return n; }));
  const toggle = async () => { const d = await api('/auth/settings', { method: 'PATCH', body: { notifyEmail: !user.notifyEmail } }); setUser(d.user); };
  return (
    <div className="page">
      <TopBar title="Notifications" />
      <div className="card row between mt12"><div><b>Email notifications</b><div className="small muted">Also send important events by email</div></div>
        <button className={`switch ${user.notifyEmail ? 'on' : ''}`} onClick={toggle} role="switch" aria-checked={user.notifyEmail}><span /></button></div>
      <div className="stack mt16">
        {loading ? <Spinner /> : data.length === 0 ? <Empty icon="bell" title="No notifications" /> : data.map((n) => (
          <Link key={n.id} to={n.link || '#'} className={`card notif ${n.read ? '' : 'unread'}`}><p>{n.text}</p><span className="small muted">{fmtDateTime(n.at)}</span></Link>
        ))}
      </div>
    </div>
  );
}

export function Security() {
  const toast = useToast();
  const sessions = useLoad(() => api('/auth/sessions'));
  const [p, setP] = useState({ current: '', next: '' });
  const [err, setErr] = useState('');
  const change = async (e) => {
    e.preventDefault(); setErr('');
    try { await api('/auth/password', { method: 'POST', body: p }); setP({ current: '', next: '' }); toast('Password changed, other sessions signed out'); sessions.reload(); }
    catch (ex) { setErr(ex.message); }
  };
  const others = async () => { const r = await api('/auth/logout-others', { method: 'POST' }); toast(`Sessions signed out: ${r.closed}`); sessions.reload(); };
  return (
    <div className="page">
      <TopBar title="Security" />
      <div className="card mt12 sec-list">
        {[['lock', 'Passwords are hashed with Argon2id'], ['shieldCheck', 'Passport data is encrypted with AES-256-GCM'], ['card', 'Card numbers are never stored — only a token'], ['eye', 'Every action is written to a tamper-proof audit log']].map(([i, t]) => (
          <div key={t} className="row gap8 small"><Icon name={i} size={16} className="green" />{t}</div>))}
      </div>
      <p className="eyebrow mt24 mb8">CHANGE PASSWORD</p>
      <form className="card stack" onSubmit={change}>
        <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={p.current} onChange={(e) => setP({ ...p, current: e.target.value })} required /></Field>
        <Field label="New password" hint="At least 10 characters, letters and digits"><input className="input" type="password" autoComplete="new-password" minLength={10} value={p.next} onChange={(e) => setP({ ...p, next: e.target.value })} required /></Field>
        {err && <div className="alert alert-red">{err}</div>}
        <button className="btn btn-primary">Change password</button>
      </form>
      <div className="row between mt24 mb8"><p className="eyebrow">ACTIVE SESSIONS</p><button className="link small" onClick={others}>Sign out others</button></div>
      <div className="stack">
        {sessions.data?.map((s, i) => (
          <div key={i} className="card"><div className="row between"><b className="small">{(s.userAgent || 'Unknown device').slice(0, 48)}</b>{s.current && <span className="chip chip-green">Current</span>}</div>
            <p className="small muted mt4">IP {s.ip || '—'} · last active {fmtDateTime(new Date(s.lastSeen).toISOString())}</p></div>))}
      </div>
    </div>
  );
}

const KIND = { hold: 'Payment frozen', release: 'Deal payout', refund: 'Refund', withdraw: 'Withdrawal to card', split: 'Dispute decision' };

export function Wallet() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const { data, loading, reload } = useLoad(() => api('/wallet'));
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const withdraw = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const d = await api('/wallet/withdraw', { method: 'POST', body: { amountCents: Math.round(parseFloat(amount) * 100) }, idempotent: true });
      setUser(d.user); setOpen(false); setAmount(''); reload(); toast('Funds sent to your card');
    } catch (ex) { toast(ex.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="page">
      <TopBar title="Balance & transactions" />
      <div className="balance-hero mt12">
        <span className="small">Available to withdraw</span>
        <b>{money(user.balanceCents)}</b>
        <button className="btn btn-white btn-sm" disabled={user.balanceCents <= 0} onClick={() => { setAmount((user.balanceCents / 100).toFixed(2)); setOpen(true); }}>Withdraw to card</button>
      </div>
      <p className="eyebrow mt24 mb8">TRANSACTION HISTORY</p>
      {loading ? <Spinner /> : data.operations.length === 0 ? <Empty icon="wallet" title="No transactions yet" /> : (
        <div className="card list">{data.operations.map((o) => (
          <Link key={o.id} to={o.dealId ? `/deals/${o.dealId}` : '#'} className="list-row op">
            <div><b className="small">{KIND[o.kind] || o.kind}</b><div className="small muted">{o.dealCode ? `${o.dealCode} · ` : ''}{fmtDateTime(o.at)}</div></div>
            <b className={o.kind === 'withdraw' ? '' : o.amountCents > 0 ? 'green' : ''}>{o.kind === 'withdraw' ? '−' + money(-o.amountCents) : (o.amountCents > 0 ? '+' : '−') + money(Math.abs(o.amountCents))}</b>
          </Link>))}</div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Withdraw funds">
        <form onSubmit={withdraw} className="stack">
          <Field label={`Amount, $ (to card •••• ${user.card?.last4 || '—'})`}><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} required /></Field>
          <button className="btn btn-primary" disabled={busy}>Withdraw</button>
        </form>
      </Sheet>
    </div>
  );
}
