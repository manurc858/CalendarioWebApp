import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { cacheGet, cacheSet, cacheClear } from '../utils.js';
import App from '../App.jsx';

// Puerta de acceso: muestra la app solo con sesión válida.
// Si este dispositivo ya entró antes, la app se pinta al instante (con los
// datos en caché) y la comprobación se hace en segundo plano.
export default function AuthGate() {
  const [state, setState] = useState(() => (cacheGet('auth-ok', false) ? 'ok' : 'checking'));
  const [required, setRequired] = useState(() => cacheGet('auth-required', false));

  useEffect(() => {
    let alive = true;
    api.authStatus()
      .then(s => {
        if (!alive) return;
        setRequired(!!s.required);
        cacheSet('auth-required', !!s.required);
        const ok = !s.required || s.authenticated;
        cacheSet('auth-ok', ok);
        setState(ok ? 'ok' : 'login');
      })
      .catch(() => {
        // sin conexión: se deja pasar; la app muestra su aviso de "sin conexión"
        if (alive) setState(prev => (prev === 'checking' ? 'ok' : prev));
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      cacheSet('auth-ok', false);
      setRequired(true);
      setState('login');
    };
    window.addEventListener('api-unauthorized', onUnauthorized);
    return () => window.removeEventListener('api-unauthorized', onUnauthorized);
  }, []);

  const handleLogout = useCallback(async () => {
    try { await api.logout(); } catch { /* se cierra igualmente en este dispositivo */ }
    cacheClear();
    setRequired(true);
    setState('login');
  }, []);

  if (state === 'checking') {
    return <div className="login-screen" aria-busy="true" />;
  }
  if (state === 'login') {
    return <LoginScreen onSuccess={() => { cacheSet('auth-ok', true); setState('ok'); }} />;
  }
  return <App onLogout={required ? handleLogout : null} />;
}

function LoginScreen({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(
        err.status === 401 ? 'Contraseña incorrecta.'
          : err.status === 429 ? 'Demasiados intentos. Espera unos minutos.'
            : 'No se ha podido conectar con el servidor.'
      );
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <img className="login-logo" src="/favicon.svg" alt="" width="44" height="44" />
        <h1 className="login-title">Agenda</h1>
        <p className="login-sub">Introduce la contraseña para entrar.</p>
        <label className="login-label" htmlFor="login-password">Contraseña</label>
        <input
          id="login-password"
          className="login-input"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={e => setPassword(e.target.value)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'login-error' : undefined}
        />
        {error && <p id="login-error" className="login-error" role="alert">{error}</p>}
        <button className="btn btn-primary login-submit" type="submit" disabled={!password || busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
