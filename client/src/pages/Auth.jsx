import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, setCsrf } from '../api.js';
import { useAuth } from '../App.jsx';
import { Icon, Field, LogoMark, Wordmark } from '../ui.jsx';

export function Welcome() {
  const [sp] = useSearchParams();
  const q = sp.get('next') ? `?next=${encodeURIComponent(sp.get('next'))}` : '';
  return (
    <div className="page welcome">
      <div className="welcome-hero">
        <div className="brand"><LogoMark size={56} /><div><Wordmark /><div className="tagline">Trust in every deal</div></div></div>
        <p className="eyebrow">PROTECTION · TRUST · EXCHANGE</p>
        <h1>Safe online deals between buyers and sellers</h1>
        <p className="muted">Kelishen holds the payment until the buyer confirms they received the item. After confirmation, the money goes to the seller.</p>
      </div>
      <div className="steps">
        {[['snow', 'Payment is frozen', 'Funds are held in escrow and don\'t reach the seller until you confirm the deal'],
          ['check', 'Confirm receipt', 'Got the item or service? Confirm it and the seller gets paid'],
          ['gavel', 'Fair disputes', 'If something goes wrong, open a dispute and the Kelishen team will sort it out']].map(([i, t, d]) => (
          <div className="step" key={t}><span className="step-icon"><Icon name={i} /></span><div><b>{t}</b><p className="muted small">{d}</p></div></div>
        ))}
      </div>
      <div className="stack">
        <Link to={`/register${q}`} className="btn btn-primary">Create account</Link>
        <Link to={`/login${q}`} className="btn btn-ghost">I already have an account</Link>
      </div>
    </div>
  );
}

function AuthForm({ mode }) {
  const [sp] = useSearchParams();
  const { setUser } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const body = mode === 'login' ? { email: f.email, password: f.password } : f;
      const d = await api(`/auth/${mode}`, { method: 'POST', body });
      setCsrf(d.csrfToken);
      setUser(d.user);
      // the redirect is handled by <Guest> in App.jsx (to ?next, or to /verify after sign-up)
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  const q = sp.get('next') ? `?next=${encodeURIComponent(sp.get('next'))}` : '';

  return (
    <div className="page auth">
      <div className="brand"><LogoMark size={44} /><Wordmark className="sm" /></div>
      <h1 className="h1">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="muted mb20">{mode === 'login' ? 'Sign in to continue your safe deals' : 'A couple of minutes and your deals are protected'}</p>
      <form onSubmit={submit} className="stack">
        {mode === 'register' && <Field label="Name"><input className="input" value={f.name} onChange={set('name')} autoComplete="name" required minLength={2} maxLength={60} /></Field>}
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} autoComplete="email" required /></Field>
        <Field label="Password" hint={mode === 'register' ? 'At least 10 characters, letters and digits' : null}>
          <input className="input" type="password" value={f.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 10 : 1} />
        </Field>
        {err && <div className="alert alert-red">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p className="center-text mt20 muted">
        {mode === 'login' ? <>No account? <Link className="link" to={`/register${q}`}>Sign up</Link></> : <>Already have an account? <Link className="link" to={`/login${q}`}>Sign in</Link></>}
      </p>
      {mode === 'login' && <div className="demo-box small"><b>Demo accounts</b><br />alex@kelishen.local · olivia@kelishen.local — <code>Demo12345!</code></div>}
    </div>
  );
}
export const Login = () => <AuthForm mode="login" />;
export const Register = () => <AuthForm mode="register" />;
