import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, uploadFile } from '../api.js';
import { useAuth } from '../App.jsx';
import { Icon, Field, TopBar, useLoad, Spinner } from '../ui.jsx';

const fmtCard = (v) => v.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
const fmtExp = (v) => { const d = v.replace(/\D/g, '').slice(0, 4); return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; };

export default function Verify() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const kyc = useLoad(() => api('/kyc'));
  const [f, setF] = useState({ fullName: '', passportNumber: '', number: '', exp: '', cvc: '' });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, fmt = (x) => x) => (e) => setF({ ...f, [k]: fmt(e.target.value) });

  if (kyc.loading) return <div className="page"><Spinner /></div>;
  if (['verified', 'pending'].includes(user.kycStatus)) {
    const k = kyc.data;
    return (
      <div className="page">
        <TopBar title="Личные данные" />
        <div className="center-col mt24">
          <span className={`big-icon ${user.kycStatus === 'verified' ? 'green' : 'orange'}`}><Icon name={user.kycStatus === 'verified' ? 'shieldCheck' : 'clock'} size={34} /></span>
          <h1 className="h2 mt12">{user.kycStatus === 'verified' ? 'Личность подтверждена' : 'Заявка на проверке'}</h1>
          <p className="muted center-text">{user.kycStatus === 'verified' ? 'Вам доступны оплата и получение средств по сделкам' : 'Обычно проверка занимает несколько минут'}</p>
        </div>
        <div className="card list mt24">
          <div className="list-row"><span className="muted">ФИО</span><b>{k.fullName}</b></div>
          <div className="list-row"><span className="muted">Паспорт</span><b>{k.passportMasked}</b></div>
          <div className="list-row"><span className="muted">Фото документа</span><b>{k.hasPhoto ? 'Загружено' : '—'}</b></div>
          <div className="list-row"><span className="muted">Карта</span><b>{k.card ? `${k.card.brand} •••• ${k.card.last4}` : '—'}</b></div>
        </div>
        <p className="secure-line mt16"><Icon name="lock" size={14} /> Данные хранятся в зашифрованном виде (AES-256-GCM)</p>
      </div>
    );
  }

  const pick = async (e) => {
    const fl = e.target.files?.[0];
    if (!fl) return;
    setErr(''); setUploading(true);
    try { setFile(await uploadFile(fl, 'kyc')); } catch (ex) { setErr(ex.message); } finally { setUploading(false); e.target.value = ''; }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return setErr('Загрузите фото паспорта');
    setErr(''); setBusy(true);
    try {
      const d = await api('/kyc', { method: 'POST', body: { fullName: f.fullName, passportNumber: f.passportNumber.replace(/\s/g, ''), fileId: file.id, card: { number: f.number, exp: f.exp, cvc: f.cvc } } });
      setUser(d.user);
      setF({ fullName: '', passportNumber: '', number: '', exp: '', cvc: '' }); // не держим данные карты в памяти дольше нужного
      nav('/', { replace: true });
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <TopBar title="Настройка аккаунта" right={<Link to="/support" className="link small">Помощь</Link>} />
      <div className="row between small mt8"><b className="blue">Шаг 1 из 2</b><span className="muted">Далее: проверка</span></div>
      <div className="progress"><span style={{ width: '50%' }} /></div>
      {user.kycStatus === 'rejected' && <div className="alert alert-red mt12">Заявка отклонена{user.kycNote ? `: ${user.kycNote}` : ''}. Отправьте данные повторно.</div>}
      <h1 className="h1 mt16">Подтвердите личность для безопасных сделок</h1>
      <p className="muted">Быстрая проверка защищает вас и ваши платежи.</p>
      <div className="alert alert-orange mt12 small">Это демо-версия. Не загружайте настоящий паспорт и не вводите реальные данные карты — используйте тестовую карту 4242 4242 4242 4242.</div>

      <form onSubmit={submit} className="stack mt20" autoComplete="off">
        <b className="h3">Личные данные</b>
        <Field label="ФИО"><input className="input" placeholder="Как в паспорте" value={f.fullName} onChange={set('fullName')} required /></Field>
        <Field label="Номер паспорта"><input className="input" placeholder="Например, ID1234567" value={f.passportNumber} onChange={set('passportNumber', (v) => v.toUpperCase())} required /></Field>
        <label className={`upload ${file ? 'done' : ''}`}>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} hidden />
          <span className="upload-icon"><Icon name={file ? 'check' : 'camera'} /></span>
          <div><b>{uploading ? 'Загрузка…' : file ? file.name : 'Загрузить фото паспорта'}</b><span className="small muted">JPG или PNG · до 10 МБ</span></div>
          <Icon name="upload" size={18} />
        </label>

        <div className="row between mt8"><b className="h3">Способ оплаты</b><span className="chip chip-blue"><Icon name="lock" size={12} /> Защищено</span></div>
        <p className="muted small">Карта для оплаты сделок через эскроу и получения выплат.</p>
        <div className="card-input">
          <label><span className="field-label">Номер карты</span>
            <div className="row"><input className="bare" inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" value={f.number} onChange={set('number', fmtCard)} required /><Icon name="card" className="muted" /></div></label>
          <div className="split">
            <label><span className="field-label">Срок</span><input className="bare" inputMode="numeric" autoComplete="cc-exp" placeholder="MM / YY" value={f.exp} onChange={set('exp', fmtExp)} required /></label>
            <label><span className="field-label">CVV</span><input className="bare" type="password" inputMode="numeric" autoComplete="cc-csc" placeholder="3 цифры" maxLength={4} value={f.cvc} onChange={set('cvc', (v) => v.replace(/\D/g, ''))} required /></label>
          </div>
        </div>
        <p className="secure-line"><Icon name="lock" size={13} /> Списаний при верификации не будет. Номер карты не хранится — только токен платёжного провайдера.</p>
        {err && <div className="alert alert-red">{err}</div>}
        <button className="btn btn-primary" disabled={busy || uploading}>{busy ? 'Отправка…' : <>Отправить на проверку <Icon name="chevron" size={18} /></>}</button>
        <p className="center-text small muted">Ваши данные шифруются и хранятся в защищённом виде.</p>
        <p className="center-text small muted">Тест: карта 4242 4242 4242 4242, любой будущий срок и CVV</p>
      </form>
    </div>
  );
}
