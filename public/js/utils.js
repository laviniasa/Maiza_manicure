// ---------- Texto e números ----------
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (n) => brl.format(Number(n) || 0);

/** Aceita "45", "45,50", "1.234,56" ou "45.5". */
export function parseMoney(text) {
  let s = String(text ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export const moneyInput = (n) => (Number(n) || 0).toFixed(2).replace('.', ',');

// ---------- Datas (sempre no horário local do aparelho) ----------
const pad = (n) => String(n).padStart(2, '0');

export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, days) {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

export const fmtDate = (d) =>
  (typeof d === 'string' && d.length === 10 ? parseDate(d) : new Date(d)).toLocaleDateString('pt-BR');

export const fmtTime = (d) =>
  new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const fmtLongDate = (d) =>
  d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

export const fmtMonth = (d) =>
  d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

export function daysBetween(fromIso, toIso) {
  return Math.round((parseDate(toIso) - parseDate(fromIso)) / 86400000);
}

export function timeInput(d) {
  const x = new Date(d);
  return `${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

// ---------- WhatsApp ----------
export function phoneDigits(phone) {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return digits;
}

export function waLink(phone, text = '') {
  const digits = phoneDigits(phone);
  if (digits.length < 12) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function fillTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] ?? '' : m));
}

export function fmtPhone(phone) {
  const d = String(phone ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone || '';
}

// ---------- Interface ----------
export function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

/**
 * Abre um formulário em janela (modal).
 * onSubmit recebe (valores, form); se lançar erro, a mensagem aparece na janela.
 */
export function openForm({ title, body, submitLabel = 'Salvar', onSubmit, onOpen, extraActions = '' }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `
    <form method="dialog" novalidate>
      <header class="modal-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Fechar">✕</button>
      </header>
      <div class="modal-body">${body}</div>
      <p class="form-error" role="alert" hidden></p>
      <footer class="modal-foot">
        ${extraActions}
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
      </footer>
    </form>`;
  document.body.append(dialog);

  const form = dialog.querySelector('form');
  const errorEl = dialog.querySelector('.form-error');
  const close = () => { dialog.close(); dialog.remove(); };

  dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    errorEl.hidden = true;
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      await onSubmit(values, form);
      close();
    } catch (err) {
      errorEl.textContent = err.message || 'Algo deu errado.';
      errorEl.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  dialog.showModal();
  onOpen?.(form, close);
  return { dialog, form, close };
}

export function confirmDialog(message, { confirmLabel = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const { dialog } = openForm({
      title: 'Confirmar',
      body: `<p>${esc(message)}</p>`,
      submitLabel: confirmLabel,
      onSubmit: async () => { answered = true; resolve(true); },
    });
    if (danger) dialog.querySelector('[type=submit]').classList.add('btn-danger');
    dialog.addEventListener('close', () => { if (!answered) resolve(false); });
  });
}

export function emptyState(text, actionHtml = '') {
  return `<div class="empty"><p>${esc(text)}</p>${actionHtml}</div>`;
}

export function loading() {
  return '<div class="loading" aria-label="Carregando"><span></span><span></span><span></span></div>';
}
