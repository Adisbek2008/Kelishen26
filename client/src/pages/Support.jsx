import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, money } from '../api.js';
import { useAuth } from '../App.jsx';
import { Icon, TopBar, TabBar, Sheet, StatusChip, Empty } from '../ui.jsx';
import Chat from '../components/Chat.jsx';

export default function Support() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [pick, setPick] = useState(null);
  const [key, setKey] = useState(0);

  const openDispute = async () => {
    const deals = await api('/deals');
    setPick(deals.filter((d) => ['funds_reserved', 'delivered'].includes(d.status)));
  };
  const ask = async (text) => { await api('/support/messages', { method: 'POST', body: { text } }); setKey((k) => k + 1); };

  return (
    <>
      <div className="page with-tabs support-page">
        <TopBar back={false} title={<span className="row gap8"><span className="agent-avatar">S<i /></span><span className="col"><b>Kelishen Support 24/7</b><span className="small"><span className="green">● Online</span> <span className="muted">· replies within a minute</span></span></span></span>} />
        <p className="muted small mt12">A little help goes a long way.</p>
        <div className="presets">
          <button onClick={openDispute} className="on">Open a dispute</button>
          <button onClick={() => ask('I have a question about identity verification')}>Verification</button>
          <button onClick={() => ask('I have a question about a payment')}>Payment question</button>
        </div>
        <Chat key={key} path="/support/messages" purpose="support" meId={user.id} />
      </div>
      <TabBar />
      <Sheet open={!!pick} onClose={() => setPick(null)} title="Which deal is the dispute about?">
        {pick?.length === 0 ? <Empty title="No paid deals" text="A dispute can only be opened for a deal with frozen funds" /> :
          <div className="stack">{pick?.map((d) => (
            <button key={d.id} className="card pick-card" onClick={() => nav(`/deals/${d.id}?dispute=1`)}>
              <div className="row between"><b>{d.title}</b><b>{money(d.amountCents)}</b></div>
              <div className="mt8"><StatusChip status={d.status} /></div>
            </button>))}</div>}
      </Sheet>
    </>
  );
}
