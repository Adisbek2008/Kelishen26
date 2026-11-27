import { useEffect, useState, createContext, useContext, useCallback } from 'react';
import { NavLink, useNavigate, Link } from 'react-router-dom';
import { money } from './api.js';

// ---------- Icons (stroke 1.8, 24x24, rounded caps — Kelishen icon style) ----------
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  support: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2zm16 0a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2zm-3 2v1a3 3 0 0 1-3 3h-2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0',
  plus: 'M12 5v14M5 12h14',
  chevron: 'm9 6 6 6-6 6',
  back: 'm15 6-6 6 6 6',
  shield: 'M12 3 4 6v6c0 5 3.4 8.4 8 9.5 4.6-1.1 8-4.5 8-9.5V6z',
  shieldCheck: 'M12 3 4 6v6c0 5 3.4 8.4 8 9.5 4.6-1.1 8-4.5 8-9.5V6zM9 12l2 2 4-4',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  check: 'm5 12 5 5 9-10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3-4-4',
  clip: 'm21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7',
  send: 'M12 19V5M6 11l6-6 6 6',
  upload: 'M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  download: 'M12 4v11M7 10l5 5 5-5M4 19h16',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  file: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  idcard: 'M3 5h18v14H3zM8 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-3 4a3 3 0 0 1 6 0M14 9h4M14 13h4',
  invite: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 12.5-4.3M19 14v6M16 17h6',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  refund: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v4l3 2',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4v4M17 14h.01',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  share: 'M12 3v13M7 8l5-5 5 5M5 14v6h14v-6',
  x: 'M6 6l12 12M18 6 6 18',
  gavel: 'm14 5 5 5M11 8l5 5M9 10l5-5 5 5-5 5zM3 21l7-7',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  // Snowflake = funds temporarily frozen in escrow (brand book: not a decoration)
  snow: 'M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9.5 3.6 12 5.2l2.5-1.6M9.5 20.4 12 18.8l2.5 1.6M4 10.4l2.6-1.2-.2-2.9M20 13.6l-2.6 1.2.2 2.9M4 13.6l2.6 1.2-.2 2.9M20 10.4l-2.6-1.2.2-2.9',
};
export function Icon({ name, size = 20, className = '', fill = 'none', ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={'icon ' + className} aria-hidden="true" {...rest}>
      <path d={P[name]} />
    </svg>
  );
}

// ---------- Brand ----------
/** Kelishen logo mark: two people (buyer + seller) forming a shield around a coin. */
export function LogoMark({ size = 48, mono, className = '' }) {
  const a = mono ? 'currentColor' : '#6DBBFA', b = mono ? 'currentColor' : '#2183F5', coin = mono ? 'currentColor' : '#2183F5';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={'logo-mark ' + className} aria-hidden="true">
      <circle cx="29" cy="15" r="10" fill={a} /><circle cx="71" cy="15" r="10" fill={b} />
      <path d="M44 29c0 6-4 9-10 12-6 4-4 11-3 19 1 10 9 18 14 24 3 4 3 12-1 12C22 92 6 70 6 50c0-10 6-14 14-16l20-5c2-.5 4-1 4 0z" fill={a} opacity={mono ? 0.7 : 1} />
      <path d="M56 29c0 6 4 9 10 12 6 4 4 11 3 19-1 10-9 18-14 24-3 4-3 12 1 12 22-4 38-26 38-46 0-10-6-14-14-16l-20-5c-2-.5-4-1-4 0z" fill={b} />
      <circle cx="50" cy="58" r="13" fill={coin} />
      <path d="M54.5 52.5c-1-1.4-2.6-2-4.5-2-2.6 0-4.4 1.3-4.4 3.3 0 4.6 9 2.6 9 7.4 0 2.1-2 3.4-4.6 3.4-2 0-3.8-.8-4.8-2.3M50 47.5v3M50 64.6v3" stroke={mono ? 'var(--bg)' : '#fff'} strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}
export const Wordmark = ({ className = '' }) => <span className={'wordmark ' + className}>Kelishen</span>;

// ---------- Deal statuses ----------
export const STATUS = {
  pending_partner: { label: 'Waiting for partner', tone: 'gray', icon: 'clock' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'orange', icon: 'clock' },
  funds_reserved: { label: 'Funds frozen in escrow', tone: 'blue', icon: 'snow' },
  delivered: { label: 'Awaiting confirmation', tone: 'orange', icon: 'clock' },
  disputed: { label: 'Dispute open · Funds frozen', tone: 'red', icon: 'snow' },
  completed: { label: 'Completed · Funds released', tone: 'green', icon: 'check' },
  resolved: { label: 'Dispute resolved', tone: 'gray', icon: 'gavel' },
  refunded: { label: 'Refunded', tone: 'red', icon: 'refund' },
  cancelled: { label: 'Cancelled', tone: 'gray', icon: 'x' },
};
export const CATEGORY = { goods: 'Goods', service: 'Service', rent: 'Rental' };
export const ROLE = { buyer: 'Buyer', seller: 'Seller' };

export function StatusChip({ status }) {
  const s = STATUS[status] || { label: status, tone: 'gray', icon: 'clock' };
  return <span className={`chip chip-${s.tone}`}><Icon name={s.icon} size={13} />{s.label}</span>;
}

export function Rating({ rating, count, compact }) {
  if (rating == null) return <span className="muted small">no reviews yet</span>;
  return <span className="rating"><Icon name="star" size={13} fill="currentColor" /> <b>{rating.toFixed(1)}</b>{count != null && <span className="muted"> ({count})</span>}{compact ? null : ''}</span>;
}

// Avatar colors derived from the Kelishen palette (blues + rare orange accent)
const COLORS = ['#2183F5', '#1468D0', '#3E9BF7', '#0F5BB5', '#4A8FE0', '#F15A24', '#2E6FBF'];
export function Avatar({ name = '?', size = 40 }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const color = COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length];
  return <span className="avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}>{initials}</span>;
}

export function DealCard({ deal }) {
  return (
    <Link to={`/deals/${deal.id}`} className="card deal-card">
      <div className="row between"><b className="deal-title">{deal.title}</b><Icon name="chevron" size={18} className="muted" /></div>
      <div className="row between mt8">
        <div className="row gap6">
          {deal.myRole && <span className={`tag tag-${deal.myRole}`}>{ROLE[deal.myRole]}</span>}
          <span className="muted small">{deal.code}</span>
        </div>
        <span className="amount">{money(deal.amountCents)}</span>
      </div>
      <div className="mt12"><StatusChip status={deal.status} /></div>
      <div className="row between mt12 small">
        <span className="muted">{deal.counterparty ? `with ${deal.counterparty.name}` : 'waiting for the other party'}</span>
        {deal.counterparty && <Rating rating={deal.counterparty.rating} count={deal.counterparty.reviews} />}
      </div>
    </Link>
  );
}

export function TopBar({ title, back = true, right, sub }) {
  const nav = useNavigate();
  return (
    <header className="topbar">
      {back ? <button className="icon-btn" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))} aria-label="Back"><Icon name="back" /></button> : <span style={{ width: 36 }} />}
      <div className="topbar-title"><b>{title}</b>{sub && <span className="muted small">{sub}</span>}</div>
      {right || <span style={{ width: 36 }} />}
    </header>
  );
}

export function TabBar() {
  const items = [['/', 'home', 'Home'], ['/history', 'history', 'History'], ['/support', 'support', 'Support'], ['/profile', 'user', 'Profile']];
  return (
    <nav className="tabbar">
      {items.map(([to, icon, label]) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => 'tab' + (isActive ? ' active' : '')}>
          <span className="tab-icon"><Icon name={icon} size={22} /></span>{label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([v, l]) => (
        <button type="button" key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const f = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between mb12"><b className="h3">{title}</b><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  );
}

export function Stars({ value, onChange }) {
  return (
    <div className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button type="button" key={n} onClick={() => onChange(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= value ? 'on' : ''}>
          <Icon name="star" size={30} fill="currentColor" />
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon = 'shield', title, text, children }) {
  return <div className="empty"><span className="empty-icon"><Icon name={icon} size={28} /></span><b>{title}</b>{text && <p className="muted">{text}</p>}{children}</div>;
}

export const Spinner = () => <div className="spinner" aria-label="Loading" />;

// ---------- Toast ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [t, setT] = useState(null);
  const show = useCallback((text, tone = 'ok') => { setT({ text, tone, id: Math.random() }); }, []);
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), 3200); return () => clearTimeout(id); }, [t]);
  return <ToastCtx.Provider value={show}>{children}{t && <div className={`toast toast-${t.tone}`} role="status">{t.text}</div>}</ToastCtx.Provider>;
}

/** Data-loading hook with reload */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => fn().then((data) => setState({ data, error: null, loading: false }), (error) => setState({ data: null, error, loading: false })), deps); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (data) => setState((s) => ({ ...s, data })) };
}
