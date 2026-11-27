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
        <TopBar title="Personal details" />
        <div className="center-col mt24">
          <span className={`big-icon ${user.kycStatus === 'verified' ? 'green' : 'orange'}`}><Icon name={user.kycStatus === 'verified' ? 'shieldCheck' : 'clock'} size={34} /></span>
          <h1 className="h2 mt12">{user.kycStatus === 'verified' ? 'Identity verified' : 'Application under review'}</h1>
          <p className="muted center-text">{user.kycStatus === 'verified' ? 'You can now pay and receive money in deals' : 'Review usually takes a few minutes'}</p>
        </div>
        <div className="card list mt24">
          <div className="list-row"><span className="muted">Full name</span><b>{k.fullName}</b></div>
          <div className="list-row"><span className="muted">Passport</span><b>{k.passportMasked}</b></div>
          <div className="list-row"><span className="muted">Document photo</span><b>{k.hasPhoto ? 'Uploaded' : '—'}</b></div>
          <div className="list-row"><span className="muted">Card</span><b>{k.card ? `${k.card.brand} •••• ${k.card.last4}` : '—'}</b></div>
        </div>
        <p className="secure-line mt16"><Icon name="lock" size={14} /> Your data is stored encrypted (AES-256-GCM)</p>
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
    if (!file) return setErr('Please upload a photo of your passport');
    setErr(''); setBusy(true);
    try {
      const d = await api('/kyc', { method: 'POST', body: { fullName: f.fullName, passportNumber: f.passportNumber.replace(/\s/g, ''), fileId: file.id, card: { number: f.number, exp: f.exp, cvc: f.cvc } } });
      setUser(d.user);
      setF({ fullName: '', passportNumber: '', number: '', exp: '', cvc: '' }); // don't keep card data in memory longer than needed
      nav('/', { replace: true });
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <TopBar title="Account setup" right={<Link to="/support" className="link small">Help</Link>} />
      <div className="row between small mt8"><b className="blue">Step 1 of 2</b><span className="muted">Next: review</span></div>
      <div className="progress"><span style={{ width: '50%' }} /></div>
      {user.kycStatus === 'rejected' && <div className="alert alert-red mt12">Application rejected{user.kycNote ? `: ${user.kycNote}` : ''}. Please resubmit your details.</div>}
      <h1 className="h1 mt16">Verify your identity for safe deals</h1>
      <p className="muted">A quick check protects you and your payments.</p>
      <div className="alert alert-orange mt12 small">This is a demo. Don't upload a real passport or enter real card details — use the test card 4242 4242 4242 4242.</div>

      <form onSubmit={submit} className="stack mt20" autoComplete="off">
        <b className="h3">Personal details</b>
        <Field label="Full name"><input className="input" placeholder="As shown in your passport" value={f.fullName} onChange={set('fullName')} required /></Field>
        <Field label="Passport number"><input className="input" placeholder="e.g. ID1234567" value={f.passportNumber} onChange={set('passportNumber', (v) => v.toUpperCase())} required /></Field>
        <label className={`upload ${file ? 'done' : ''}`}>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} hidden />
          <span className="upload-icon"><Icon name={file ? 'check' : 'camera'} /></span>
          <div><b>{uploading ? 'Uploading…' : file ? file.name : 'Upload passport photo'}</b><span className="small muted">JPG or PNG · up to 10 MB</span></div>
          <Icon name="upload" size={18} />
        </label>

        <div className="row between mt8"><b className="h3">Payment method</b><span className="chip chip-blue"><Icon name="lock" size={12} /> Secured</span></div>
        <p className="muted small">Card for paying deals via escrow and receiving payouts.</p>
        <div className="card-input">
          <label><span className="field-label">Card number</span>
            <div className="row"><input className="bare" inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" value={f.number} onChange={set('number', fmtCard)} required /><Icon name="card" className="muted" /></div></label>
          <div className="split">
            <label><span className="field-label">Expiry</span><input className="bare" inputMode="numeric" autoComplete="cc-exp" placeholder="MM / YY" value={f.exp} onChange={set('exp', fmtExp)} required /></label>
            <label><span className="field-label">CVV</span><input className="bare" type="password" inputMode="numeric" autoComplete="cc-csc" placeholder="3 digits" maxLength={4} value={f.cvc} onChange={set('cvc', (v) => v.replace(/\D/g, ''))} required /></label>
          </div>
        </div>
        <p className="secure-line"><Icon name="lock" size={13} /> You won't be charged during verification. We don't store your card number — only the payment provider's token.</p>
        {err && <div className="alert alert-red">{err}</div>}
        <button className="btn btn-primary" disabled={busy || uploading}>{busy ? 'Submitting…' : <>Submit for review <Icon name="chevron" size={18} /></>}</button>
        <p className="center-text small muted">Your data is encrypted and stored securely.</p>
        <p className="center-text small muted">Test: card 4242 4242 4242 4242, any future expiry and CVV</p>
      </form>
    </div>
  );
}
