import { useEffect, useRef, useState } from 'react';
import { api, uploadFile, fmtTime, fmtSize } from '../api.js';
import { Icon, Avatar, useToast } from '../ui.jsx';

export function FileCard({ file }) {
  const isImg = file.mime.startsWith('image/');
  return (
    <a className="file-card" href={`/api/files/${file.id}`} download={file.name}>
      {isImg ? <img src={`/api/files/${file.id}?inline=1`} alt="" className="file-thumb" /> : <span className="file-icon"><Icon name="file" /><small>PDF</small></span>}
      <div className="grow"><b className="small">{file.name}</b><span className="muted small">{file.mime.split('/')[1].toUpperCase()} · {fmtSize(file.size)}</span></div>
      <Icon name="download" size={18} />
    </a>
  );
}

/** Shared chat for deals and support. Polls for new messages every 4 seconds. */
export default function Chat({ path, purpose, dealId, meId, disabled, presets }) {
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const lastId = useRef(0);
  const endRef = useRef(null);
  const toast = useToast();

  const poll = async () => {
    try {
      const fresh = await api(`${path}?after=${lastId.current}`);
      if (fresh.length) {
        lastId.current = fresh[fresh.length - 1].id;
        setMsgs((m) => [...m, ...fresh.filter((x) => !m.some((y) => y.id === x.id))]);
      }
    } catch { /* network — retry on next tick */ }
  };
  useEffect(() => {
    lastId.current = 0; setMsgs([]); poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [path]); // eslint-disable-line
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs.length]);

  const send = async (body) => {
    setBusy(true);
    try { await api(path, { method: 'POST', body }); setText(''); await poll(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const attach = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try { const up = await uploadFile(f, purpose, dealId); await send({ text: text.trim(), fileId: up.id }); } catch (ex) { toast(ex.message, 'err'); setBusy(false); }
  };

  let lastDay = '';
  return (
    <div className="chat">
      {presets}
      <div className="chat-list">
        {msgs.map((m) => {
          const day = new Date(m.at).toLocaleDateString('en-US', { day: 'numeric', month: 'long' });
          const showDay = day !== lastDay; lastDay = day;
          const mine = m.senderId === meId;
          const sys = m.senderRole === 'system';
          return (
            <div key={m.id}>
              {showDay && <div className="chat-day">{day}</div>}
              {sys ? <div className="chat-system">{m.text}</div> : (
                <div className={`bubble-wrap ${mine ? 'mine' : ''}`}>
                  {!mine && <span className="bubble-author">{m.senderRole === 'support' ? 'Sofia · Support' : m.senderRole === 'admin' ? `${m.senderName || 'Kelishen team'} · Kelishen` : m.senderName}</span>}
                  <div className={`bubble ${mine ? 'mine' : ''} ${m.senderRole === 'admin' ? 'admin' : ''}`}>
                    {m.text && <p>{m.text}</p>}
                    {m.file && <FileCard file={m.file} />}
                  </div>
                  <span className="bubble-time">{fmtTime(m.at)}{mine && <Icon name="check" size={12} />}</span>
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {!disabled && (
        <form className="composer" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send({ text: text.trim() }); }}>
          <div className="composer-input">
            <label className="icon-btn" aria-label="Attach file"><Icon name="clip" size={19} /><input type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={attach} disabled={busy} /></label>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" maxLength={4000} />
          </div>
          <button className="send-btn" disabled={busy || !text.trim()} aria-label="Send"><Icon name="send" size={20} /></button>
        </form>
      )}
    </div>
  );
}

export { Avatar };
