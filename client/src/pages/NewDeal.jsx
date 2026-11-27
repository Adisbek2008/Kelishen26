import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, money, feeRate, feePercent } from '../api.js';
import { TopBar, Field, Segmented, Icon } from '../ui.jsx';

function preview(amountCents, feePayer) {
  const fee = Math.round(amountCents * feeRate(amountCents));
  const buyerFee = feePayer === 'buyer' ? fee : feePayer === 'split' ? Math.ceil(fee / 2) : 0;
  return { fee, buyerPays: amountCents + buyerFee, sellerGets: amountCents - (fee - buyerFee) };
}

export default function NewDeal() {
  const nav = useNavigate();
  const [f, setF] = useState({ myRole: 'buyer', title: '', category: 'goods', amount: '', description: '', conditions: '', deadline: '', feePayer: 'split' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF({ ...f, [k]: v?.target ? v.target.value : v });
  const cents = Math.round(parseFloat(String(f.amount).replace(',', '.')) * 100) || 0;
  const p = preview(cents, f.feePayer);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const d = await api('/deals', { method: 'POST', body: {
        title: f.title, category: f.category, amountCents: cents, myRole: f.myRole, feePayer: f.feePayer,
        description: f.description, conditions: f.conditions, ...(f.deadline && { deadline: f.deadline }) } });
      nav(`/deals/${d.id}`, { replace: true });
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <TopBar title="New deal" />
      <form onSubmit={submit} className="stack mt16">
        <Field label="Your role"><Segmented value={f.myRole} onChange={set('myRole')} options={[['buyer', 'I\'m buying'], ['seller', 'I\'m selling']]} /></Field>
        <Field label="What is being sold"><input className="input" placeholder="e.g. iPhone 15 Pro" value={f.title} onChange={set('title')} required minLength={3} maxLength={120} /></Field>
        <Field label="Deal type"><Segmented value={f.category} onChange={set('category')} options={[['goods', 'Goods'], ['service', 'Service'], ['rent', 'Rental']]} /></Field>
        <Field label="Amount, som" hint="Fee: 3% for deals up to 3,000 som, 1% above"><input className="input amount-input" inputMode="decimal" placeholder="0" value={f.amount} onChange={(e) => set('amount')(e.target.value.replace(/[^\d.,]/g, ''))} required /></Field>
        <Field label="Description"><textarea className="input" rows={3} placeholder="Model, condition, what's included…" value={f.description} onChange={set('description')} maxLength={2000} /></Field>
        <Field label="Completion conditions" hint="What must happen for the buyer to confirm the deal"><textarea className="input" rows={3} placeholder="e.g. courier delivery by Nov 30, inspection on receipt" value={f.conditions} onChange={set('conditions')} maxLength={2000} /></Field>
        <Field label="Deadline"><input className="input" type="date" value={f.deadline} onChange={set('deadline')} min={new Date().toISOString().slice(0, 10)} /></Field>
        <Field label={`Who pays the ${cents > 0 ? feePercent(cents) + '% ' : ''}fee`}><Segmented value={f.feePayer} onChange={set('feePayer')} options={[['buyer', 'Buyer'], ['split', 'Split 50/50'], ['seller', 'Seller']]} /></Field>

        {cents > 0 && (
          <div className="card list">
            <div className="list-row"><span className="muted">Service fee ({feePercent(cents)}%)</span><b>{money(p.fee)}</b></div>
            <div className="list-row"><span className="muted">Buyer pays</span><b>{money(p.buyerPays)}</b></div>
            <div className="list-row"><span className="muted">Seller receives</span><b className="green">{money(p.sellerGets)}</b></div>
          </div>
        )}
        {err && <div className="alert alert-red">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create and get link'}</button>
        <p className="secure-line"><Icon name="snow" size={14} /> The payment will be frozen and won't reach the seller until confirmation</p>
      </form>
    </div>
  );
}
