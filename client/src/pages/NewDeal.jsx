import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, money } from '../api.js';
import { TopBar, Field, Segmented, Icon } from '../ui.jsx';

const FEE = 0.02, MIN_FEE = 100;
function preview(amountCents, feePayer) {
  const fee = Math.max(MIN_FEE, Math.round(amountCents * FEE));
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
      <TopBar title="Новая сделка" />
      <form onSubmit={submit} className="stack mt16">
        <Field label="Ваша роль"><Segmented value={f.myRole} onChange={set('myRole')} options={[['buyer', 'Я покупатель'], ['seller', 'Я продавец']]} /></Field>
        <Field label="Что продаётся"><input className="input" placeholder="Например, iPhone 15 Pro" value={f.title} onChange={set('title')} required minLength={3} maxLength={120} /></Field>
        <Field label="Тип сделки"><Segmented value={f.category} onChange={set('category')} options={[['goods', 'Товар'], ['service', 'Услуга'], ['rent', 'Аренда']]} /></Field>
        <Field label="Сумма, $"><input className="input amount-input" inputMode="decimal" placeholder="0.00" value={f.amount} onChange={(e) => set('amount')(e.target.value.replace(/[^\d.,]/g, ''))} required /></Field>
        <Field label="Описание"><textarea className="input" rows={3} placeholder="Модель, состояние, комплектация…" value={f.description} onChange={set('description')} maxLength={2000} /></Field>
        <Field label="Условия выполнения" hint="Что должно произойти, чтобы покупатель подтвердил сделку"><textarea className="input" rows={3} placeholder="Например: доставка курьером до 30 ноября, проверка при получении" value={f.conditions} onChange={set('conditions')} maxLength={2000} /></Field>
        <Field label="Срок выполнения"><input className="input" type="date" value={f.deadline} onChange={set('deadline')} min={new Date().toISOString().slice(0, 10)} /></Field>
        <Field label="Кто оплачивает комиссию 2%"><Segmented value={f.feePayer} onChange={set('feePayer')} options={[['buyer', 'Покупатель'], ['split', 'Пополам'], ['seller', 'Продавец']]} /></Field>

        {cents > 0 && (
          <div className="card list">
            <div className="list-row"><span className="muted">Комиссия сервиса</span><b>{money(p.fee)}</b></div>
            <div className="list-row"><span className="muted">Покупатель платит</span><b>{money(p.buyerPays)}</b></div>
            <div className="list-row"><span className="muted">Продавец получит</span><b className="green">{money(p.sellerGets)}</b></div>
          </div>
        )}
        {err && <div className="alert alert-red">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Создание…' : 'Создать и получить ссылку'}</button>
        <p className="secure-line"><Icon name="shieldCheck" size={14} /> Деньги будут зарезервированы и не уйдут продавцу до подтверждения</p>
      </form>
    </div>
  );
}
