import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { one, query } from './db.js';

const scryptAsync = promisify(scrypt);
const SESSION_DAYS = 30;
const COOKIE = 'sid';

const SECRET = process.env.SESSION_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') throw new Error('Defina SESSION_SECRET');
  return 'dev-secret-local';
})();

// ---------- Senhas ----------
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

// ---------- Sessão (cookie assinado) ----------
const sign = (data) => createHmac('sha256', SECRET).update(data).digest('base64url');

function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({
    uid: user.id, v: user.session_version, exp: Date.now() + SESSION_DAYS * 864e5,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).filter(([k]) => k)
    .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';

export function setSessionCookie(req, res, user) {
  const parts = [`${COOKIE}=${makeToken(user)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req, res) {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

/** Devolve o usuário da sessão ou null. */
export async function currentUser(req) {
  const data = readToken(parseCookies(req.headers.cookie)[COOKIE]);
  if (!data) return null;
  const user = await one('select id, email, session_version from users where id = $1', [data.uid]);
  return user && user.session_version === data.v ? user : null;
}

// ---------- Limite de tentativas de login ----------
const attempts = new Map();
export function tooManyAttempts(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60000);
  attempts.set(key, list);
  return list.length >= 10;
}
export function recordFailure(key) {
  attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
}

// ---------- Conta inicial (variáveis ADMIN_EMAIL / ADMIN_PASSWORD) ----------
export async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await one('select id from users where email = $1', [email]);
  if (!existing) {
    await query('insert into users (email, password_hash) values ($1, $2)', [email, await hashPassword(password)]);
    console.log(`Conta criada: ${email}`);
  } else if (process.env.ADMIN_RESET_PASSWORD === 'true') {
    await query('update users set password_hash = $2, session_version = session_version + 1 where id = $1',
      [existing.id, await hashPassword(password)]);
    console.log(`Senha redefinida: ${email}`);
  }
}
