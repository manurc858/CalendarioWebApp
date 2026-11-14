// Acceso con contraseña única.
//  - Si APP_PASSWORD no está definida, el acceso queda abierto (uso local).
//  - Si lo está, toda la API exige una cookie de sesión firmada (HMAC).
// No se guarda nada en la base de datos: la cookie lleva su caducidad y su firma.
import crypto from 'node:crypto';

const COOKIE = 'agenda_session';
const MAX_AGE_S = 90 * 24 * 60 * 60; // 90 días
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

const password = () => process.env.APP_PASSWORD || '';
export const authRequired = () => !!password();

// La clave de firma deriva de la contraseña: cambiarla cierra todas las sesiones.
const secret = () =>
  process.env.SESSION_SECRET || crypto.createHash('sha256').update(`agenda-session:${password()}`).digest('hex');

const sign = (value) => crypto.createHmac('sha256', secret()).update(value).digest('hex');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1 && part.slice(0, idx).trim() === COOKIE) return part.slice(idx + 1).trim();
  }
  return '';
}

function isAuthenticated(req) {
  if (!authRequired()) return true;
  const [exp, sig] = readCookie(req).split('.');
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(exp));
}

function cookieFlags(req) {
  const https = req.secure || req.headers['x-forwarded-proto'] === 'https';
  // Con CORS_ORIGIN (cliente en otro dominio) la cookie debe ser SameSite=None.
  const sameSite = process.env.CORS_ORIGIN && https ? 'None' : 'Lax';
  return `Path=/; HttpOnly; SameSite=${sameSite}${https ? '; Secure' : ''}`;
}

// Freno básico a intentos por fuerza bruta (en memoria, por IP).
const fails = new Map();
function tooManyFails(ip) {
  const rec = fails.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > FAIL_WINDOW_MS) { fails.delete(ip); return false; }
  return rec.count >= MAX_FAILS;
}
function noteFail(ip) {
  const rec = fails.get(ip);
  if (!rec || Date.now() - rec.first > FAIL_WINDOW_MS) fails.set(ip, { first: Date.now(), count: 1 });
  else rec.count++;
}

export function mountAuth(app) {
  app.get('/api/auth/status', (req, res) => {
    res.json({ required: authRequired(), authenticated: isAuthenticated(req) });
  });

  app.post('/api/auth/login', (req, res) => {
    if (!authRequired()) return res.json({ ok: true });
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    if (tooManyFails(ip)) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    }
    if (!safeEqual(req.body?.password ?? '', password())) {
      noteFail(ip);
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    fails.delete(ip);
    const exp = String(Date.now() + MAX_AGE_S * 1000);
    res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; Max-Age=${MAX_AGE_S}; ${cookieFlags(req)}`);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
    res.json({ ok: true });
  });

  // Todo lo demás bajo /api exige sesión.
  app.use('/api', (req, res, next) => {
    if (isAuthenticated(req)) return next();
    res.status(401).json({ error: 'No autorizado' });
  });
}
