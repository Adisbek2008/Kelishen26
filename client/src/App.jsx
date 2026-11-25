import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { api, setCsrf } from './api.js';
import { Spinner } from './ui.jsx';
import { Welcome, Login, Register } from './pages/Auth.jsx';
import Home from './pages/Home.jsx';
import Verify from './pages/Verify.jsx';
import NewDeal from './pages/NewDeal.jsx';
import DealPage from './pages/Deal.jsx';
import Invite from './pages/Invite.jsx';
import History from './pages/History.jsx';
import Support from './pages/Support.jsx';
import { Profile, UserProfile, Notifications, Security, Wallet } from './pages/Profile.jsx';
import Admin from './pages/Admin.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function Private({ children, admin }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to={loc.pathname === '/' ? '/welcome' : `/welcome?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

// Для гостевых страниц: если пользователь уже вошёл — ведём на ?next (только относительный путь), иначе на главную
function Guest({ children, fallback = '/' }) {
  const { user } = useAuth();
  const [sp] = useSearchParams();
  const n = sp.get('next');
  const next = n && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') && n !== '/' ? n : fallback;
  return user ? <Navigate to={next} replace /> : children;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const refresh = useCallback(() => api('/auth/me').then((d) => { setCsrf(d.csrfToken); setUser(d.user); return d.user; }), []);
  useEffect(() => { refresh().catch(() => setUser(null)); }, [refresh]);
  useEffect(() => {
    const f = () => setUser(null);
    window.addEventListener('sd:unauth', f);
    return () => window.removeEventListener('sd:unauth', f);
  }, []);

  if (user === undefined) return <div className="app center"><Spinner /></div>;
  return (
    <AuthCtx.Provider value={{ user, setUser, refresh }}>
      <div className="app">
        <Routes>
          <Route path="/welcome" element={<Guest><Welcome /></Guest>} />
          <Route path="/login" element={<Guest><Login /></Guest>} />
          <Route path="/register" element={<Guest fallback="/verify"><Register /></Guest>} />
          <Route path="/invite/:token" element={<Invite />} />
          <Route path="/" element={<Private><Home /></Private>} />
          <Route path="/verify" element={<Private><Verify /></Private>} />
          <Route path="/deals/new" element={<Private><NewDeal /></Private>} />
          <Route path="/deals/:id" element={<Private><DealPage /></Private>} />
          <Route path="/history" element={<Private><History /></Private>} />
          <Route path="/support" element={<Private><Support /></Private>} />
          <Route path="/profile" element={<Private><Profile /></Private>} />
          <Route path="/users/:id" element={<Private><UserProfile /></Private>} />
          <Route path="/notifications" element={<Private><Notifications /></Private>} />
          <Route path="/security" element={<Private><Security /></Private>} />
          <Route path="/wallet" element={<Private><Wallet /></Private>} />
          <Route path="/admin" element={<Private admin><Admin /></Private>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </AuthCtx.Provider>
  );
}
