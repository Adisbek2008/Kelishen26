import { Link } from 'react-router-dom';
import { api, money } from '../api.js';
import { useAuth } from '../App.jsx';
import { Icon, DealCard, TabBar, useLoad, Spinner, Empty } from '../ui.jsx';

const ACTIVE = ['pending_partner', 'awaiting_payment', 'funds_reserved', 'delivered', 'disputed'];

export default function Home() {
  const { user } = useAuth();
  const { data, loading } = useLoad(() => api('/deals'));
  const active = (data || []).filter((d) => ACTIVE.includes(d.status));
  const first = user.name.split(' ')[0];

  return (
    <>
      <div className="page with-tabs">
        <div className="row between">
          <div>
            <p className="eyebrow">ВАШИ ДЕНЬГИ ПОД ЗАЩИТОЙ</p>
            <h1 className="hello">Привет, {first} {user.kycStatus === 'verified' && <span className="verified-dot" title="Личность подтверждена"><Icon name="shieldCheck" size={18} /></span>}</h1>
          </div>
          <Link to="/notifications" className="bell" aria-label="Уведомления"><Icon name="bell" size={22} />{user.unread > 0 && <span className="badge">{user.unread}</span>}</Link>
        </div>

        {user.kycStatus !== 'verified' && (
          <Link to="/verify" className="card kyc-banner mt16">
            <Icon name="idcard" size={22} />
            <div><b>{user.kycStatus === 'pending' ? 'Верификация на проверке' : 'Подтвердите личность'}</b>
              <p className="small muted">{user.kycStatus === 'pending' ? 'Мы сообщим, как только всё проверим' : 'Нужно для оплаты и получения денег по сделкам'}</p></div>
            <Icon name="chevron" size={18} />
          </Link>
        )}

        <Link to="/deals/new" className="cta mt16">
          <span className="cta-plus"><Icon name="plus" size={22} /></span>
          <div><b>Создать безопасную сделку</b><span>Платите уверенно. Всегда.</span></div>
          <Icon name="chevron" size={20} />
        </Link>
        <p className="secure-note"><Icon name="shieldCheck" size={14} /> Безопасный эскроу. Никаких догадок.</p>

        {user.balanceCents > 0 && (
          <Link to="/wallet" className="card balance-card mt16">
            <Icon name="wallet" size={22} /><div><span className="muted small">Доступно к выводу</span><b className="h3">{money(user.balanceCents)}</b></div><Icon name="chevron" size={18} />
          </Link>
        )}

        <div className="row between mt24 mb12">
          <h2 className="h2">Активные сделки <span className="count">{active.length}</span></h2>
          <Link to="/history" className="link small">Все</Link>
        </div>
        {loading ? <Spinner /> : active.length === 0
          ? <Empty title="Пока нет активных сделок" text="Создайте сделку и отправьте ссылку второй стороне" />
          : <div className="stack">{active.map((d) => <DealCard key={d.id} deal={d} />)}</div>}
      </div>
      <TabBar />
    </>
  );
}
