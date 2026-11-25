import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, money, fmtDate } from '../api.js';
import { useAuth } from '../App.jsx';
import { Icon, Avatar, Rating, CATEGORY, ROLE, useLoad, Spinner, Empty } from '../ui.jsx';

export default function Invite() {
  const { token } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const { data: d, error, loading } = useLoad(() => api(`/invite/${encodeURIComponent(token)}`), [token]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="page"><Spinner /></div>;
  if (error) return <div className="page"><Empty icon="alert" title="Приглашение недоступно" text={error.message}><Link className="btn btn-ghost mt16" to="/">На главную</Link></Empty></div>;
  const myRole = d.creatorRole === 'buyer' ? 'seller' : 'buyer';
  const next = encodeURIComponent(`/invite/${token}`);

  const accept = async () => {
    setBusy(true); setErr('');
    try { const deal = await api(`/invite/${encodeURIComponent(token)}/accept`, { method: 'POST' }); nav(`/deals/${deal.id}`, { replace: true }); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <p className="eyebrow mt16">ПРИГЛАШЕНИЕ В БЕЗОПАСНУЮ СДЕЛКУ</p>
      <h1 className="h1">{d.title}</h1>
      <div className="row gap6 mt8"><span className="tag">{CATEGORY[d.category]}</span><span className="muted small">{d.code}</span></div>
      <div className="card mt16">
        <div className="row gap12"><Avatar name={d.creator.name} size={44} />
          <div className="grow"><b>{d.creator.name} {d.creator.verified && <Icon name="shieldCheck" size={15} className="blue" />}</b>
            <div className="small"><Rating rating={d.creator.rating} count={d.creator.reviews} /> · <span className="muted">{d.creator.completedDeals} сделок</span></div></div>
          <span className={`tag tag-${d.creatorRole}`}>{ROLE[d.creatorRole]}</span>
        </div>
      </div>
      <div className="card list mt12">
        <div className="list-row"><span className="muted">Сумма сделки</span><b className="h3">{money(d.amountCents)}</b></div>
        <div className="list-row"><span className="muted">Ваша роль</span><b>{ROLE[myRole]}</b></div>
        <div className="list-row"><span className="muted">{myRole === 'buyer' ? 'Вы заплатите' : 'Вы получите'}</span><b>{money(myRole === 'buyer' ? d.buyerPays : d.sellerGets)}</b></div>
        {d.deadline && <div className="list-row"><span className="muted">Срок</span><b>{fmtDate(d.deadline)}</b></div>}
      </div>
      {(d.description || d.conditions) && <div className="card mt12">{d.description && <p>{d.description}</p>}{d.conditions && <><b className="small muted">Условия</b><p>{d.conditions}</p></>}</div>}
      <p className="secure-line mt16"><Icon name="lock" size={14} /> Деньги покупателя резервируются SafeDeal и переводятся продавцу только после подтверждения</p>
      {err && <div className="alert alert-red mt12">{err}</div>}
      <div className="stack mt16">
        {user ? <button className="btn btn-primary" onClick={accept} disabled={busy}>{busy ? 'Подождите…' : 'Принять и присоединиться'}</button>
          : <><Link className="btn btn-primary" to={`/register?next=${next}`}>Зарегистрироваться и принять</Link><Link className="btn btn-ghost" to={`/login?next=${next}`}>Войти</Link></>}
      </div>
    </div>
  );
}
