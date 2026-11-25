import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, setCsrf } from '../api.js';
import { useAuth } from '../App.jsx';
import { Icon, Field } from '../ui.jsx';

export function Welcome() {
  const [sp] = useSearchParams();
  const q = sp.get('next') ? `?next=${encodeURIComponent(sp.get('next'))}` : '';
  return (
    <div className="page welcome">
      <div className="welcome-hero">
        <span className="logo"><Icon name="shieldCheck" size={34} /></span>
        <p className="eyebrow">ВАШИ ДЕНЬГИ ПОД ЗАЩИТОЙ</p>
        <h1>Безопасные сделки между незнакомыми людьми</h1>
        <p className="muted">Покупатель платит — деньги резервируются. Продавец получает их только после выполнения условий.</p>
      </div>
      <div className="steps">
        {[['lock', 'Деньги в резерве', 'Средства не уходят продавцу, пока вы не подтвердите сделку'],
          ['check', 'Подтверждение', 'Получили товар или услугу — подтвердите, и продавец получит оплату'],
          ['gavel', 'Арбитраж', 'Если что-то пошло не так — откройте спор, администрация разберётся']].map(([i, t, d]) => (
          <div className="step" key={t}><span className="step-icon"><Icon name={i} /></span><div><b>{t}</b><p className="muted small">{d}</p></div></div>
        ))}
      </div>
      <div className="stack">
        <Link to={`/register${q}`} className="btn btn-primary">Создать аккаунт</Link>
        <Link to={`/login${q}`} className="btn btn-ghost">У меня есть аккаунт</Link>
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
      // перенаправление выполняет <Guest> в App.jsx (на ?next или на /verify после регистрации)
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  const q = sp.get('next') ? `?next=${encodeURIComponent(sp.get('next'))}` : '';

  return (
    <div className="page auth">
      <span className="logo"><Icon name="shieldCheck" size={30} /></span>
      <h1 className="h1">{mode === 'login' ? 'С возвращением' : 'Регистрация'}</h1>
      <p className="muted mb20">{mode === 'login' ? 'Войдите, чтобы продолжить безопасные сделки' : 'Пара минут — и ваши сделки под защитой'}</p>
      <form onSubmit={submit} className="stack">
        {mode === 'register' && <Field label="Имя"><input className="input" value={f.name} onChange={set('name')} autoComplete="name" required minLength={2} maxLength={60} /></Field>}
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} autoComplete="email" required /></Field>
        <Field label="Пароль" hint={mode === 'register' ? 'Минимум 10 символов, буквы и цифры' : null}>
          <input className="input" type="password" value={f.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 10 : 1} />
        </Field>
        {err && <div className="alert alert-red">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
      </form>
      <p className="center-text mt20 muted">
        {mode === 'login' ? <>Нет аккаунта? <Link to={`/register${q}`}>Зарегистрироваться</Link></> : <>Уже есть аккаунт? <Link to={`/login${q}`}>Войти</Link></>}
      </p>
      {mode === 'login' && <div className="demo-box small"><b>Демо-аккаунты</b><br />alex@safedeal.local · olivia@safedeal.local — <code>Demo12345!</code></div>}
    </div>
  );
}
export const Login = () => <AuthForm mode="login" />;
export const Register = () => <AuthForm mode="register" />;
