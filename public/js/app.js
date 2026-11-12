import { api } from './api.js';
import { getSettings, getUser, clearCache } from './data.js';
import { esc, loading } from './utils.js';
import { icon } from './icons.js';

import inicio from './views/inicio.js';
import agenda from './views/agenda.js';
import clientes from './views/clientes.js';
import retornos from './views/retornos.js';
import caixa from './views/caixa.js';
import servicos from './views/servicos.js';
import config from './views/config.js';

const ROUTES = { inicio, agenda, clientes, retornos, caixa, servicos, config };

const NAV = [
  ['inicio', 'Início'],
  ['agenda', 'Agenda'],
  ['clientes', 'Clientes'],
  ['retornos', 'Retornos'],
  ['caixa', 'Caixa'],
];

const app = document.getElementById('app');
let renderToken = 0;


function renderLogin() {
  app.innerHTML = `
    <main class="auth">
      <form class="auth-card" id="login" novalidate>
        <img src="icons/logo.svg" class="auth-logo" alt="">
        <p class="eyebrow center">Studio de unhas</p>
        <h1 class="center">Bem-vinda</h1>
        <div class="gold-rule"></div>
        <p class="muted center">Entre para ver sua agenda.</p>
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
      <a href="#/inicio" class="brand"><img src="icons/logo.svg" class="brand-logo" alt=""><span id="business-name"></span></a>
      <nav class="top-links">
        <a href="#/servicos">Serviços</a>
        <a href="#/config">Ajustes</a>
      </nav>
    </header>
    <main id="view" class="view"></main>
    <nav class="tabbar">
      ${NAV.map(([key, label]) => `<a href="#/${key}" data-route="${key}">${icon(key)}<span>${label}</span></a>`).join('')}
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
