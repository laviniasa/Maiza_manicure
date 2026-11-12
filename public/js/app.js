import { api } from './api.js';
import { getSettings, getUser, clearCache } from './data.js';
import { esc, loading } from './utils.js';

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
    try {
      await api('/login', { method: 'POST', body: { email: form.email.value.trim(), password: form.password.value } });
      renderShell();
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('forgot').addEventListener('click', () => {
    showError('Para redefinir a senha, fale com o suporte do sistema.');
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
      <button class="btn btn-ghost" id="retry">Tentar de novo</button></div>`;
    view.querySelector('#retry').addEventListener('click', () => location.reload());
  }
}

async function start() {
  window.addEventListener('hashchange', route);
  window.addEventListener('auth:expired', () => {
    clearCache();
    if (!document.getElementById('login')) renderLogin();
  });
  try {
    await getUser();
    renderShell();
  } catch {
    renderLogin();
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

start();
