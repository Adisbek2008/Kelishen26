import { Link } from 'react-router-dom';
import { api, money } from '../api.js';
import { useAuth } from '../App.jsx';
import { Icon, DealCard, TabBar, useLoad, Spinner, Empty, LogoMark, Wordmark } from '../ui.jsx';

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
          <div className="row gap8"><LogoMark size={30} /><Wordmark className="sm" /></div>
          <Link to="/notifications" className="bell" aria-label="Notifications"><Icon name="bell" size={22} />{user.unread > 0 && <span className="badge">{user.unread}</span>}</Link>
        </div>
        <div className="mt16">
          <p className="eyebrow">TRUST IN EVERY DEAL</p>
          <h1 className="hello">Hi, {first} {user.kycStatus === 'verified' && <span className="verified-dot" title="Identity verified"><Icon name="shieldCheck" size={18} /></span>}</h1>
        </div>

        {user.kycStatus !== 'verified' && (
          <Link to="/verify" className="card kyc-banner mt16">
            <Icon name="idcard" size={22} />
            <div><b>{user.kycStatus === 'pending' ? 'Verification under review' : 'Verify your identity'}</b>
              <p className="small muted">{user.kycStatus === 'pending' ? 'We\'ll let you know as soon as it\'s checked' : 'Required to pay and receive money in deals'}</p></div>
            <Icon name="chevron" size={18} />
          </Link>
        )}

        <Link to="/deals/new" className="cta mt16">
          <span className="cta-plus"><Icon name="plus" size={22} /></span>
          <div><b>Create a safe deal</b><span>Buy and sell online safely</span></div>
          <Icon name="chevron" size={20} />
        </Link>
        <p className="secure-note"><Icon name="snow" size={14} /> Payment stays frozen until the buyer confirms receipt</p>

        {user.balanceCents > 0 && (
          <Link to="/wallet" className="card balance-card mt16">
            <Icon name="wallet" size={22} /><div><span className="muted small">Available to withdraw</span><b className="h3">{money(user.balanceCents)}</b></div><Icon name="chevron" size={18} />
          </Link>
        )}

        <div className="row between mt24 mb12">
          <h2 className="h2">Active deals <span className="count">{active.length}</span></h2>
          <Link to="/history" className="link small">See all</Link>
        </div>
        {loading ? <Spinner /> : active.length === 0
          ? <Empty title="No active deals yet" text="Create a deal and send the link to the other party" />
          : <div className="stack">{active.map((d) => <DealCard key={d.id} deal={d} />)}</div>}
      </div>
      <TabBar />
    </>
  );
}
