import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { api, money, fmtDate, fmtDateTime, uploadFile, copyText } from '../api.js';
import { useAuth } from '../App.jsx';
import { Icon, TopBar, StatusChip, Avatar, Rating, Sheet, Stars, Field, Segmented, useLoad, Spinner, Empty, useToast, CATEGORY, ROLE } from '../ui.jsx';
import Chat from '../components/Chat.jsx';

const STEPS = [['Создана', ['pending_partner', 'awaiting_payment']], ['Оплачена', ['funds_reserved']], ['Выполнена', ['delivered', 'disputed']], ['Завершена', ['completed', 'resolved', 'refunded']]];

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
  if (!u) return <div className="party"><span className="avatar empty-avatar">?</span><div><span className="muted small">{label}</span><b>Ожидается</b></div></div>;
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
    if (!confirm('Решение необратимо: средства будут перечислены. Продолжить?')) return;
    setBusy(true); setErr('');
    try {
      await api(`/admin/deals/${deal.id}/resolve`, { method: 'POST', body: { decision, comment, ...(decision === 'split' && { buyerPercent: Number(pct) }) } });
      toast('Спор решён'); onDone?.();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="stack">
      <Segmented value={decision} onChange={setDecision} options={[['buyer', 'Вернуть покупателю'], ['split', 'Разделить'], ['seller', 'Продавцу']]} />
      {decision === 'split' && (
        <Field label={`Покупателю ${pct}% (${money(Math.round(held * pct / 100))}) · Продавцу ${100 - pct}% (${money(held - Math.round(held * pct / 100))})`}>
          <input type="range" min={1} max={99} value={pct} onChange={(e) => setPct(e.target.value)} />
        </Field>
      )}
      <p className="small muted">В резерве: {money(held)}{decision === 'seller' && ' · продавец получит сумму за вычетом комиссии'}</p>
      <Field label="Обоснование решения (увидят обе стороны)"><textarea className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} required minLength={5} /></Field>
      {err && <div className="alert alert-red">{err}</div>}
      <button className="btn btn-primary" disabled={busy}><Icon name="gavel" size={18} /> Вынести решение</button>
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
  if (error) return <div className="page"><TopBar title="Сделка" /><Empty icon="alert" title="Сделка не найдена" text={error.message} /></div>;

  const act = async (action, body, opts = {}) => {
    setBusy(true);
    try {
      const r = await api(`/deals/${id}/${action}`, { method: 'POST', body, ...opts });
      setData(r.deal || r);
      setSheet(null);
      refresh();
      return true;
    } catch (e) {
      toast(e.code === 'kyc_required' ? 'Сначала пройдите верификацию в профиле' : e.message, 'err');
      if (e.status === 409) reload();
      return false;
    } finally { setBusy(false); }
  };
  const has = (a) => d.actions.includes(a);
  const copy = async () => ((await copyText(d.inviteUrl)) ? toast('Ссылка скопирована') : toast('Не удалось скопировать — выделите ссылку вручную', 'err'));
  const share = () => navigator.share?.({ title: `SafeDeal: ${d.title}`, text: `Приглашаю в безопасную сделку «${d.title}» на ${money(d.amountCents)}`, url: d.inviteUrl }).catch(() => {});
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
          {d.myRole && <span className={`tag tag-${d.myRole}`}>Вы — {ROLE[d.myRole].toLowerCase()}</span>}
        </div>
        <div className="deal-amount mt16">{money(d.amountCents)}</div>
        {d.escrowCents > 0 && <p className="secure-line"><Icon name="lock" size={14} /> {money(d.escrowCents)} зарезервировано в SafeDeal</p>}
      </div>

      <Stepper status={d.status} />

      {d.inviteUrl && (
        <div className="card invite-box">
          <b>Пригласите вторую сторону</b>
          <p className="small muted">Отправьте ссылку {d.myRole === 'buyer' ? 'продавцу' : 'покупателю'}. Ссылка одноразовая — после принятия она перестанет работать.</p>
          <div className="invite-url">{d.inviteUrl}</div>
          <div className="row gap8 mt8">
            <button className="btn btn-sm btn-primary grow" onClick={copy}><Icon name="copy" size={16} /> Копировать</button>
            {navigator.share && <button className="btn btn-sm btn-ghost grow" onClick={share}><Icon name="share" size={16} /> Поделиться</button>}
          </div>
        </div>
      )}

      {/* Действия */}
      <div className="actions stack">
        {has('pay') && <button className="btn btn-primary" onClick={() => setSheet('pay')}><Icon name="lock" size={18} /> Оплатить {money(d.buyerPays)}</button>}
        {has('deliver') && <button className="btn btn-primary" onClick={() => setSheet('deliver')}><Icon name="check" size={18} /> Я выполнил условия</button>}
        {has('confirm') && <button className="btn btn-green" onClick={() => setSheet('confirm')}><Icon name="check" size={18} /> Подтвердить получение</button>}
        {has('review') && <button className="btn btn-primary" onClick={() => setSheet('review')}><Icon name="star" size={18} /> Оставить отзыв</button>}
        <div className="row gap8">
          {has('dispute') && <button className="btn btn-sm btn-danger-ghost grow" onClick={() => setSheet('dispute')}><Icon name="alert" size={16} /> Открыть спор</button>}
          {has('refund') && <button className="btn btn-sm btn-ghost grow" onClick={() => confirm('Вернуть покупателю все средства и отменить сделку?') && act('refund')} disabled={busy}><Icon name="refund" size={16} /> Вернуть деньги</button>}
          {has('cancel') && <button className="btn btn-sm btn-ghost grow" onClick={() => confirm('Отменить сделку?') && act('cancel')} disabled={busy}>Отменить сделку</button>}
        </div>
        {d.status === 'delivered' && d.autoReleaseAt && <p className="small muted center-text">Если покупатель не ответит, средства будут переведены продавцу автоматически {fmtDate(d.autoReleaseAt)}</p>}
        {d.status === 'disputed' && <div className="alert alert-orange"><b>Идёт рассмотрение спора.</b> Средства заморожены. Приложите доказательства в чат — администрация примет решение.</div>}
      </div>

      {has('resolve') && <div className="card mt16"><b className="h3">Решение по спору</b><div className="mt12"><ResolveForm deal={d} onDone={reload} /></div></div>}

      {d.resolution && (
        <div className="card mt16 resolution">
          <b><Icon name="gavel" size={16} /> Решение администрации</b>
          <p className="small mt8">{d.resolution.decision === 'buyer' ? 'Средства возвращены покупателю' : d.resolution.decision === 'seller' ? 'Средства переведены продавцу' : `Разделено: покупателю ${money(d.resolution.buyerCents)}, продавцу ${money(d.resolution.sellerCents)}`}</p>
          <p className="muted small">{d.resolution.comment}</p>
        </div>
      )}

      <div className="card mt16">
        <Party label="Покупатель" u={d.buyer} />
        <div className="divider" />
        <Party label="Продавец" u={d.seller} />
      </div>

      <div className="card list mt12">
        <div className="list-row"><span className="muted">Сумма</span><b>{money(d.amountCents)}</b></div>
        <div className="list-row"><span className="muted">Комиссия 2% ({d.feePayer === 'split' ? 'пополам' : d.feePayer === 'buyer' ? 'платит покупатель' : 'платит продавец'})</span><b>{money(d.fee)}</b></div>
        <div className="list-row"><span className="muted">Покупатель платит</span><b>{money(d.buyerPays)}</b></div>
        <div className="list-row"><span className="muted">Продавец получит</span><b>{money(d.sellerGets)}</b></div>
        {d.deadline && <div className="list-row"><span className="muted">Срок</span><b>{fmtDate(d.deadline)}</b></div>}
      </div>
      {(d.description || d.conditions) && (
        <div className="card mt12">
          {d.description && <><b className="small muted">Описание</b><p className="pre">{d.description}</p></>}
          {d.conditions && <><b className="small muted">Условия выполнения</b><p className="pre">{d.conditions}</p></>}
        </div>
      )}

      <div className="tabs mt20">
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Чат и документы</button>
        <button className={tab === 'events' ? 'on' : ''} onClick={() => setTab('events')}>История</button>
      </div>
      {tab === 'chat'
        ? <Chat path={`/deals/${d.id}/messages`} purpose="deal" dealId={d.id} meId={user.id} disabled={d.status === 'cancelled' || (!d.myRole && user.role !== 'admin')} />
        : <div className="timeline">{d.events.map((e, i) => <div key={i} className="tl-item"><span className="tl-dot" /><div><p>{e.text}</p><span className="muted small">{fmtDateTime(e.at)}</span></div></div>)}</div>}

      {/* Модальные окна */}
      <Sheet open={sheet === 'pay'} onClose={() => setSheet(null)} title="Оплата через эскроу">
        {user.card ? <>
          <div className="card list">
            <div className="list-row"><span className="muted">Сумма сделки</span><b>{money(d.amountCents)}</b></div>
            <div className="list-row"><span className="muted">Комиссия</span><b>{money(d.buyerPays - d.amountCents)}</b></div>
            <div className="list-row"><span className="muted">Итого</span><b className="h3">{money(d.buyerPays)}</b></div>
            <div className="list-row"><span className="muted">Карта</span><b>{user.card.brand} •••• {user.card.last4}</b></div>
          </div>
          <p className="secure-line mt12"><Icon name="shieldCheck" size={14} /> Деньги будут зарезервированы. Продавец получит их только после вашего подтверждения.</p>
          <button className="btn btn-primary mt16 w100" disabled={busy} onClick={() => act('pay', undefined, { idempotent: true })}>{busy ? 'Обработка…' : `Оплатить ${money(d.buyerPays)}`}</button>
        </> : <><p>Для оплаты нужно пройти верификацию и привязать карту.</p><Link to="/verify" className="btn btn-primary mt16 w100">Пройти верификацию</Link></>}
      </Sheet>

      <Sheet open={sheet === 'deliver'} onClose={() => setSheet(null)} title="Условия выполнены">
        <Field label="Комментарий для покупателя (трек-номер, детали)"><textarea className="input" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={1000} /></Field>
        <button className="btn btn-primary mt16 w100" disabled={busy} onClick={() => act('deliver', { note: form.note })}>Отметить выполнение</button>
      </Sheet>

      <Sheet open={sheet === 'confirm'} onClose={() => setSheet(null)} title="Подтвердить сделку?">
        <div className="alert alert-orange">Подтверждайте только после того, как получили товар / услугу и всё проверили. После подтверждения {money(d.sellerGets)} будут переведены продавцу — это действие необратимо.</div>
        <button className="btn btn-green mt16 w100" disabled={busy} onClick={() => act('confirm')}>Да, всё получил — перевести деньги</button>
      </Sheet>

      <Sheet open={sheet === 'dispute'} onClose={() => setSheet(null)} title="Открыть спор">
        <p className="small muted">Средства будут заморожены до решения администрации. Опишите проблему и приложите доказательства.</p>
        <Field label="Что случилось?"><textarea className="input" rows={4} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} minLength={10} maxLength={2000} placeholder="Например: товар не соответствует описанию…" /></Field>
        <label className={`upload mt12 ${form.file ? 'done' : ''}`}><input type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={attachEvidence} />
          <span className="upload-icon"><Icon name={form.file ? 'check' : 'clip'} /></span><div><b>{form.file ? form.file.name : 'Приложить доказательство'}</b><span className="small muted">Фото или PDF до 10 МБ</span></div></label>
        <button className="btn btn-danger mt16 w100" disabled={busy || form.reason.trim().length < 10} onClick={() => act('dispute', { reason: form.reason, ...(form.file && { fileId: form.file.id }) })}>Открыть спор</button>
      </Sheet>

      <Sheet open={sheet === 'review'} onClose={() => setSheet(null)} title={`Оценка: ${d.counterparty?.name || ''}`}>
        <Stars value={form.rating} onChange={(r) => setForm({ ...form, rating: r })} />
        <Field label="Комментарий"><textarea className="input" rows={3} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} maxLength={1000} /></Field>
        <button className="btn btn-primary mt16 w100" disabled={busy} onClick={() => act('review', { rating: form.rating, comment: form.comment })}>Отправить отзыв</button>
      </Sheet>
    </div>
  );
}
