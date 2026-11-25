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
        <TopBar back={false} title={<span className="row gap8"><span className="agent-avatar">С<i /></span><span className="col"><b>Поддержка SafeDeal 24/7</b><span className="small"><span className="green">● Онлайн</span> <span className="muted">· отвечаем за минуту</span></span></span></span>} />
        <p className="muted small mt12">Немного помощи — и полное спокойствие.</p>
        <div className="presets">
          <button onClick={openDispute} className="on">Открыть спор</button>
          <button onClick={() => ask('Вопрос по верификации личности')}>Верификация</button>
          <button onClick={() => ask('Вопрос по оплате')}>Вопрос по оплате</button>
        </div>
        <Chat key={key} path="/support/messages" purpose="support" meId={user.id} />
      </div>
      <TabBar />
      <Sheet open={!!pick} onClose={() => setPick(null)} title="По какой сделке спор?">
        {pick?.length === 0 ? <Empty title="Нет оплаченных сделок" text="Спор можно открыть только по сделке с зарезервированными средствами" /> :
          <div className="stack">{pick?.map((d) => (
            <button key={d.id} className="card pick-card" onClick={() => nav(`/deals/${d.id}?dispute=1`)}>
              <div className="row between"><b>{d.title}</b><b>{money(d.amountCents)}</b></div>
              <div className="mt8"><StatusChip status={d.status} /></div>
            </button>))}</div>}
      </Sheet>
    </>
  );
}
