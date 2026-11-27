import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { api, money, fmtDate, fmtDateTime, uploadFile, copyText, feePercent } from '../api.js';
import { useAuth } from '../App.jsx';
import { Icon, TopBar, StatusChip, Avatar, Rating, Sheet, Stars, Field, Segmented, useLoad, Spinner, Empty, useToast, CATEGORY, ROLE } from '../ui.jsx';
import Chat from '../components/Chat.jsx';

const STEPS = [['Created', ['pending_partner', 'awaiting_payment']], ['Paid', ['funds_reserved']], ['Delivered', ['delivered', 'disputed']], ['Completed', ['completed', 'resolved', 'refunded']]];

function Stepper({ status }) {
  if (status === 'cancelled') return null;
  const idx = STEPS.findIndex(([, s]) => s.includes(status));
  return (
    <div className="stepper">
      {STEPS.map(([label], i) => (
        <div key={label} className={`stp ${i < idx || (i === idx && i === 3) ? 'done' : i === idx ? 'cur' : ''}`}>
          <span className="stp-dot">{i < idx || (i === 3 && idx === 3) ? <Icon name="check" size={12} /> : i + 1}</span><span className="stp-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

function Party({ label, u }) {
  if (!u) return <div className="party"><span className="avatar empty-avatar">?</span><div><span className="muted small">{label}</span><b>Pending</b></div></div>;
  return (
    <Link to={`/users/${u.id}`} className="party">
      <Avatar name={u.name} size={38} />
      <div className="grow"><span className="muted small">{label}</span><b>{u.name} {u.verified && <Icon name="shieldCheck" size={14} className="blue" />}</b></div>
      <Rating rating={u.rating} count={u.reviews} />
    </Link>
  );
}

export function ResolveForm({ deal, onDone }) {
  const [decision, setDecision] = useState('buyer');
  const [pct, setPct] = useState(50);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const held = deal.escrowCents;
  const submit = async (e) => {
    e.preventDefault();
    if (!confirm('This decision is final: funds will be transferred. Continue?')) return;
    setBusy(true); setErr('');
    try {
      await api(`/admin/deals/${deal.id}/resolve`, { method: 'POST', body: { decision, comment, ...(decision === 'split' && { buyerPercent: Number(pct) }) } });
      toast('Dispute resolved'); onDone?.();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="stack">
      <Segmented value={decision} onChange={setDecision} options={[['buyer', 'Refund buyer'], ['split', 'Split'], ['seller', 'To seller']]} />
      {decision === 'split' && (
        <Field label={`Buyer ${pct}% (${money(Math.round(held * pct / 100))}) · Seller ${100 - pct}% (${money(held - Math.round(held * pct / 100))})`}>
          <input type="range" min={1} max={99} value={pct} onChange={(e) => setPct(e.target.value)} />
        </Field>
      )}
      <p className="small muted">Frozen in escrow: {money(held)}{decision === 'seller' && ' · the seller receives the amount minus the fee'}</p>
      <Field label="Reasoning (visible to both parties)"><textarea className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} required minLength={5} /></Field>
      {err && <div className="alert alert-red">{err}</div>}
      <button className="btn btn-primary" disabled={busy}><Icon name="gavel" size={18} /> Issue decision</button>
    </form>
  );
}

export default function DealPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { user, refresh } = useAuth();
  const toast = useToast();
  const { data: d, error, loading, reload, setData } = useLoad(() => api(`/deals/${id}`), [id]);
  const [tab, setTab] = useState('chat');
  const [sheet, setSheet] = useState(sp.get('dispute') === '1' ? 'dispute' : null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ note: '', reason: '', rating: 5, comment: '', file: null });

  useEffect(() => { const t = setInterval(() => api(`/deals/${id}`).then(setData).catch(() => {}), 8000); return () => clearInterval(t); }, [id]); // eslint-disable-line

  if (loading) return <div className="page"><Spinner /></div>;
  if (error) return <div className="page"><TopBar title="Deal" /><Empty icon="alert" title="Deal not found" text={error.message} /></div>;

  const act = async (action, body, opts = {}) => {
    setBusy(true);
    try {
      const r = await api(`/deals/${id}/${action}`, { method: 'POST', body, ...opts });
      setData(r.deal || r);
      setSheet(null);
      refresh();
      return true;
    } catch (e) {
      toast(e.code === 'kyc_required' ? 'Please verify your identity in your profile first' : e.message, 'err');
      if (e.status === 409) reload();
      return false;
    } finally { setBusy(false); }
  };
  const has = (a) => d.actions.includes(a);
  const copy = async () => ((await copyText(d.inviteUrl)) ? toast('Link copied') : toast('Couldn\'t copy — please select the link manually', 'err'));
  const share = () => navigator.share?.({ title: `Kelishen: ${d.title}`, text: `Join my safe deal "${d.title}" for ${money(d.amountCents)} on Kelishen`, url: d.inviteUrl }).catch(() => {});
  const attachEvidence = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try { const up = await uploadFile(f, 'deal', d.id); setForm((s) => ({ ...s, file: up })); } catch (ex) { toast(ex.message, 'err'); }
  };

  return (
    <div className="page deal-page">
      <TopBar title={d.code} sub={CATEGORY[d.category]} />
      <div className="mt12">
        <h1 className="h1">{d.title}</h1>
        <div className="row between mt8">
          <StatusChip status={d.status} />
          {d.myRole && <span className={`tag tag-${d.myRole}`}>You are the {ROLE[d.myRole].toLowerCase()}</span>}
        </div>
        <div className="deal-amount mt16">{money(d.amountCents)}</div>
        {d.escrowCents > 0 && <p className="secure-line"><Icon name="snow" size={14} /> {money(d.escrowCents)} frozen in Kelishen escrow</p>}
      </div>

      <Stepper status={d.status} />

      {d.inviteUrl && (
        <div className="card invite-box">
          <b>Invite the other party</b>
          <p className="small muted">Send this link to the {d.myRole === 'buyer' ? 'seller' : 'buyer'}. It's single-use and stops working once accepted.</p>
          <div className="invite-url">{d.inviteUrl}</div>
          <div className="row gap8 mt8">
            <button className="btn btn-sm btn-primary grow" onClick={copy}><Icon name="copy" size={16} /> Copy</button>
            {navigator.share && <button className="btn btn-sm btn-ghost grow" onClick={share}><Icon name="share" size={16} /> Share</button>}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="actions stack">
        {has('pay') && <button className="btn btn-primary" onClick={() => setSheet('pay')}><Icon name="snow" size={18} /> Pay {money(d.buyerPays)}</button>}
        {has('deliver') && <button className="btn btn-primary" onClick={() => setSheet('deliver')}><Icon name="check" size={18} /> I've fulfilled the conditions</button>}
        {has('confirm') && <button className="btn btn-green" onClick={() => setSheet('confirm')}><Icon name="check" size={18} /> Confirm receipt</button>}
        {has('review') && <button className="btn btn-primary" onClick={() => setSheet('review')}><Icon name="star" size={18} /> Leave a review</button>}
        <div className="row gap8">
          {has('dispute') && <button className="btn btn-sm btn-danger-ghost grow" onClick={() => setSheet('dispute')}><Icon name="alert" size={16} /> Open dispute</button>}
          {has('refund') && <button className="btn btn-sm btn-ghost grow" onClick={() => confirm('Refund the buyer in full and cancel the deal?') && act('refund')} disabled={busy}><Icon name="refund" size={16} /> Refund</button>}
          {has('cancel') && <button className="btn btn-sm btn-ghost grow" onClick={() => confirm('Cancel this deal?') && act('cancel')} disabled={busy}>Cancel deal</button>}
        </div>
        {d.status === 'delivered' && d.autoReleaseAt && <p className="small muted center-text">If the buyer doesn't respond, funds will be released to the seller automatically on {fmtDate(d.autoReleaseAt)}</p>}
        {d.status === 'disputed' && <div className="alert alert-blue"><Icon name="snow" size={18} /><span><b>Dispute under review.</b> Funds are frozen. Attach evidence to the chat — the Kelishen team will make a decision.</span></div>}
      </div>

      {has('resolve') && <div className="card mt16"><b className="h3">Dispute decision</b><div className="mt12"><ResolveForm deal={d} onDone={reload} /></div></div>}

      {d.resolution && (
        <div className="card mt16 resolution">
          <b><Icon name="gavel" size={16} /> Kelishen team decision</b>
          <p className="small mt8">{d.resolution.decision === 'buyer' ? 'Funds returned to the buyer' : d.resolution.decision === 'seller' ? 'Funds released to the seller' : `Split: ${money(d.resolution.buyerCents)} to the buyer, ${money(d.resolution.sellerCents)} to the seller`}</p>
          <p className="muted small">{d.resolution.comment}</p>
        </div>
      )}

      <div className="card mt16">
        <Party label="Buyer" u={d.buyer} />
        <div className="divider" />
        <Party label="Seller" u={d.seller} />
      </div>

      <div className="card list mt12">
        <div className="list-row"><span className="muted">Amount</span><b>{money(d.amountCents)}</b></div>
        <div className="list-row"><span className="muted">{feePercent(d.amountCents)}% fee ({d.feePayer === 'split' ? 'split 50/50' : d.feePayer === 'buyer' ? 'paid by buyer' : 'paid by seller'})</span><b>{money(d.fee)}</b></div>
        <div className="list-row"><span className="muted">Buyer pays</span><b>{money(d.buyerPays)}</b></div>
        <div className="list-row"><span className="muted">Seller receives</span><b>{money(d.sellerGets)}</b></div>
        {d.deadline && <div className="list-row"><span className="muted">Deadline</span><b>{fmtDate(d.deadline)}</b></div>}
      </div>
      {(d.description || d.conditions) && (
        <div className="card mt12">
          {d.description && <><b className="small muted">Description</b><p className="pre">{d.description}</p></>}
          {d.conditions && <><b className="small muted">Completion conditions</b><p className="pre">{d.conditions}</p></>}
        </div>
      )}

      <div className="tabs mt20">
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat & documents</button>
        <button className={tab === 'events' ? 'on' : ''} onClick={() => setTab('events')}>History</button>
      </div>
      {tab === 'chat'
        ? <Chat path={`/deals/${d.id}/messages`} purpose="deal" dealId={d.id} meId={user.id} disabled={d.status === 'cancelled' || (!d.myRole && user.role !== 'admin')} />
        : <div className="timeline">{d.events.map((e, i) => <div key={i} className="tl-item"><span className="tl-dot" /><div><p>{e.text}</p><span className="muted small">{fmtDateTime(e.at)}</span></div></div>)}</div>}

      {/* Sheets */}
      <Sheet open={sheet === 'pay'} onClose={() => setSheet(null)} title="Pay via escrow">
        {user.card ? <>
          <div className="card list">
            <div className="list-row"><span className="muted">Deal amount</span><b>{money(d.amountCents)}</b></div>
            <div className="list-row"><span className="muted">Fee</span><b>{money(d.buyerPays - d.amountCents)}</b></div>
            <div className="list-row"><span className="muted">Total</span><b className="h3">{money(d.buyerPays)}</b></div>
            <div className="list-row"><span className="muted">Card</span><b>{user.card.brand} •••• {user.card.last4}</b></div>
          </div>
          <p className="secure-line mt12"><Icon name="snow" size={14} /> Your payment will be frozen. The seller only receives it after you confirm.</p>
          <button className="btn btn-primary mt16 w100" disabled={busy} onClick={() => act('pay', undefined, { idempotent: true })}>{busy ? 'Processing…' : `Pay ${money(d.buyerPays)}`}</button>
        </> : <><p>To pay, verify your identity and link a card.</p><Link to="/verify" className="btn btn-primary mt16 w100">Verify identity</Link></>}
      </Sheet>

      <Sheet open={sheet === 'deliver'} onClose={() => setSheet(null)} title="Conditions fulfilled">
        <Field label="Note for the buyer (tracking number, details)"><textarea className="input" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={1000} /></Field>
        <button className="btn btn-primary mt16 w100" disabled={busy} onClick={() => act('deliver', { note: form.note })}>Mark as fulfilled</button>
      </Sheet>

      <Sheet open={sheet === 'confirm'} onClose={() => setSheet(null)} title="Confirm the deal?">
        <div className="alert alert-orange">Only confirm once you've received the item / service and checked everything. After confirmation, {money(d.sellerGets)} will be released to the seller — this can't be undone.</div>
        <button className="btn btn-green mt16 w100" disabled={busy} onClick={() => act('confirm')}>Yes, I got it — release the money</button>
      </Sheet>

      <Sheet open={sheet === 'dispute'} onClose={() => setSheet(null)} title="Open a dispute">
        <p className="small muted">Funds will stay frozen until the Kelishen team decides. Describe the problem and attach evidence.</p>
        <Field label="What happened?"><textarea className="input" rows={4} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} minLength={10} maxLength={2000} placeholder="e.g. the item doesn't match the description…" /></Field>
        <label className={`upload mt12 ${form.file ? 'done' : ''}`}><input type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={attachEvidence} />
          <span className="upload-icon"><Icon name={form.file ? 'check' : 'clip'} /></span><div><b>{form.file ? form.file.name : 'Attach evidence'}</b><span className="small muted">Photo or PDF up to 10 MB</span></div></label>
        <button className="btn btn-danger mt16 w100" disabled={busy || form.reason.trim().length < 10} onClick={() => act('dispute', { reason: form.reason, ...(form.file && { fileId: form.file.id }) })}>Open dispute</button>
      </Sheet>

      <Sheet open={sheet === 'review'} onClose={() => setSheet(null)} title={`Rate ${d.counterparty?.name || ''}`}>
        <Stars value={form.rating} onChange={(r) => setForm({ ...form, rating: r })} />
        <Field label="Comment"><textarea className="input" rows={3} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} maxLength={1000} /></Field>
        <button className="btn btn-primary mt16 w100" disabled={busy} onClick={() => act('review', { rating: form.rating, comment: form.comment })}>Submit review</button>
      </Sheet>
    </div>
  );
}
