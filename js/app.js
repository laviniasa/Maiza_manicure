import { db, isConfigured, friendlyError } from './supabase.js';
import { getSettings, clearCache } from './data.js';
import { esc, loading, toast } from './utils.js';

import inicio from './views/inicio.js';
import agenda from './views/agenda.js';
import clientes from './views/clientes.js';
import retornos from './views/retornos.js';
import caixa from './views/caixa.js';
import servicos from './views/servicos.js';
import config from './views/config.js';

const ROUTES = { inicio, agenda, clientes, retornos, caixa, servicos, config };

const NAV = [
  ['inicio', 'Início', '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'],
  ['agenda', 'Agenda', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'],
  ['clientes', 'Clientes', '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-5-5.5"/>'],
  ['retornos', 'Retornos', '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'],
  ['caixa', 'Caixa', '<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6 10v.01M18 15v.01"/>'],
];

const app = document.getElementById('app');
let renderToken = 0;

function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function renderSetupNeeded() {
  app.innerHTML = `
    <main class="auth">
      <div class="auth-card">
        <div class="brand-mark">💅</div>
        <h1>Quase lá</h1>
        <p>Preencha <code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code> em <code>js/config.js</code> para conectar o sistema ao banco de dados. O passo a passo está no README.</p>
      </div>
    </main>`;
}

function renderLogin() {
  app.innerHTML = `
    <main class="auth">
      <form class="auth-card" id="login" novalidate>
        <div class="brand-mark">💅</div>
        <h1>Bem-vinda</h1>
        <p class="muted">Entre para ver sua agenda.</p>
        <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
        <label>Senha<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">Entrar</button>
        <button class="btn btn-link" type="button" id="forgot">Esqueci minha senha</button>
      </form>
    </main>`;

  const form = document.getElementById('login');
  const errorEl = form.querySelector('.form-error');
  const showError = (msg) => { errorEl.textContent = msg; errorEl.hidden = false; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    errorEl.hidden = true;
    const { error } = await db.auth.signInWithPassword({
      email: form.email.value.trim(),
      password: form.password.value,
    });
    btn.disabled = false;
    if (error) showError(friendlyError(error).message);
  });

  document.getElementById('forgot').addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) return showError('Digite seu e-mail acima e toque de novo em "Esqueci minha senha".');
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) showError(friendlyError(error).message);
    else toast('Enviamos um link de recuperação para o seu e-mail.');
  });
}

function renderPasswordReset() {
  app.innerHTML = `
    <main class="auth">
      <form class="auth-card" id="reset" novalidate>
        <div class="brand-mark">🔑</div>
        <h1>Nova senha</h1>
        <label>Nova senha<input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">Salvar senha</button>
      </form>
    </main>`;
  const form = document.getElementById('reset');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const { error } = await db.auth.updateUser({ password: form.password.value });
    if (error) {
      const el = form.querySelector('.form-error');
      el.textContent = friendlyError(error).message;
      el.hidden = false;
      return;
    }
    toast('Senha alterada!');
    renderShell();
  });
}

async function renderShell() {
  app.innerHTML = `
    <header class="topbar">
      <a href="#/inicio" class="brand"><span class="brand-dot">💅</span><span id="business-name"></span></a>
      <nav class="top-links">
        <a href="#/servicos">Serviços</a>
        <a href="#/config">Ajustes</a>
      </nav>
    </header>
    <main id="view" class="view"></main>
    <nav class="tabbar">
      ${NAV.map(([key, label, paths]) => `<a href="#/${key}" data-route="${key}">${icon(paths)}<span>${label}</span></a>`).join('')}
    </nav>`;
  try {
    const s = await getSettings();
    document.getElementById('business-name').textContent = s.business_name;
  } catch { /* nome é opcional */ }
  route();
}

export function setBusinessName(name) {
  const el = document.getElementById('business-name');
  if (el) el.textContent = name;
}

async function route() {
  const view = document.getElementById('view');
  if (!view) return;
  const [, name = 'inicio', param = null] = (location.hash || '#/inicio').split('/');
  const render = ROUTES[name] || inicio;
  const token = ++renderToken;

  document.querySelectorAll('[data-route]').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name);
  });

  view.innerHTML = loading();
  window.scrollTo(0, 0);
  try {
    const stillCurrent = () => token === renderToken;
    await render(view, param ? decodeURIComponent(param) : null, stillCurrent);
  } catch (err) {
    if (token !== renderToken) return;
    view.innerHTML = `<div class="empty"><p>Não foi possível carregar.</p><p class="muted">${esc(err.message)}</p>
      <button class="btn btn-ghost" onclick="location.reload()">Tentar de novo</button></div>`;
  }
}

async function start() {
  if (!isConfigured) return renderSetupNeeded();

  window.addEventListener('hashchange', route);

  db.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') return renderPasswordReset();
    if (event === 'SIGNED_OUT') { clearCache(); return renderLogin(); }
    if (event === 'SIGNED_IN' && !document.getElementById('view')) renderShell();
  });

  const { data } = await db.auth.getSession();
  if (data.session) renderShell();
  else if (!location.hash.includes('type=recovery')) renderLogin();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

start();
