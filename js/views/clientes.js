import { db, check } from '../supabase.js';
import { getSettings, STATUS_LABEL } from '../data.js';
import { APPT_SELECT, openAppointmentForm } from '../appointments.js';
import {
  esc, openForm, toast, confirmDialog, emptyState, fmtPhone, waLink, fmtDate, fmtTime, money, fillTemplate,
} from '../utils.js';

export default async function clientes(view, id, stillCurrent) {
  if (id) return clientDetail(view, id, stillCurrent);

  const clients = check(await db.from('clients').select('id, name, phone').order('name'));
  if (!stillCurrent()) return;

  view.innerHTML = `
    <div class="section-head">
      <h1>Clientes</h1>
      <button class="btn btn-primary" id="new-client">+ Nova</button>
    </div>
    <input type="search" class="search" id="search" placeholder="Buscar por nome ou telefone" autocomplete="off">
    <p class="muted small" id="count"></p>
    <div class="list" id="client-list"></div>`;

  const listEl = view.querySelector('#client-list');
  const countEl = view.querySelector('#count');
  const draw = (term = '') => {
    const t = term.trim().toLowerCase();
    const digits = t.replace(/\D/g, '');
    const filtered = clients.filter((c) =>
      c.name.toLowerCase().includes(t) || (digits && (c.phone || '').replace(/\D/g, '').includes(digits)));
    countEl.textContent = `${filtered.length} cliente${filtered.length === 1 ? '' : 's'}`;
    listEl.innerHTML = filtered.length
      ? filtered.map((c) => `
          <a class="row-item" href="#/clientes/${c.id}">
            <span class="avatar">${esc(c.name.trim()[0]?.toUpperCase() ?? '?')}</span>
            <span class="row-main"><strong>${esc(c.name)}</strong><small>${esc(fmtPhone(c.phone)) || 'Sem telefone'}</small></span>
            <span class="chev">›</span>
          </a>`).join('')
      : emptyState(clients.length ? 'Nenhuma cliente encontrada.' : 'Nenhuma cliente cadastrada ainda.');
  };
  draw();
  view.querySelector('#search').addEventListener('input', (e) => draw(e.target.value));
  view.querySelector('#new-client').addEventListener('click', () =>
    openClientForm({ onSaved: (c) => { location.hash = `#/clientes/${c.id}`; } }));
}

export function openClientForm({ client = null, onSaved } = {}) {
  openForm({
    title: client ? 'Editar cliente' : 'Nova cliente',
    body: `
      <label>Nome<input name="name" required value="${esc(client?.name ?? '')}" autocomplete="off"></label>
      <label>Telefone (WhatsApp)<input name="phone" type="tel" inputmode="tel" placeholder="(11) 91234-5678" value="${esc(client?.phone ?? '')}"></label>
      <label>Observações<textarea name="notes" rows="3" placeholder="Preferências, alergias, cor favorita…">${esc(client?.notes ?? '')}</textarea></label>
      <label class="check"><input type="checkbox" name="whatsapp_opt_in" ${client?.whatsapp_opt_in ? 'checked' : ''}>
        Cliente autorizou receber lembretes pelo WhatsApp</label>`,
    async onSubmit(v) {
      const row = {
        name: v.name.trim(),
        phone: v.phone.trim() || null,
        notes: v.notes.trim() || null,
        whatsapp_opt_in: v.whatsapp_opt_in === 'on',
      };
      const saved = client
        ? check(await db.from('clients').update(row).eq('id', client.id).select().single())
        : check(await db.from('clients').insert(row).select().single());
      toast(client ? 'Cliente atualizada' : 'Cliente cadastrada');
      onSaved?.(saved);
    },
  });
}

async function clientDetail(view, id, stillCurrent) {
  const [client, history, settings] = await Promise.all([
    db.from('clients').select('*').eq('id', id).single().then(check),
    db.from('appointments').select(APPT_SELECT).eq('client_id', id).order('starts_at', { ascending: false }).then(check),
    getSettings(),
  ]);
  if (!stillCurrent()) return;

  const done = history.filter((a) => a.status === 'concluido');
  const spent = done.reduce((s, a) => s + Number(a.price), 0);
  const next = history.filter((a) => a.status === 'agendado' && new Date(a.starts_at) > new Date())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const lastDone = done[0];
  const firstName = client.name.trim().split(/\s+/)[0];
  const message = fillTemplate(settings.return_message, {
    nome: firstName,
    servico: lastDone?.services?.name?.toLowerCase() ?? 'unha',
  });
  const wa = waLink(client.phone, message);

  view.innerHTML = `
    <a href="#/clientes" class="back">‹ Clientes</a>
    <section class="card profile">
      <span class="avatar avatar-lg">${esc(client.name.trim()[0]?.toUpperCase() ?? '?')}</span>
      <h1>${esc(client.name)}</h1>
      <p class="muted">${esc(fmtPhone(client.phone)) || 'Sem telefone'}</p>
      ${client.whatsapp_opt_in ? '<span class="badge badge-concluido">Autorizou lembretes</span>' : ''}
      ${client.notes ? `<p class="notes">${esc(client.notes)}</p>` : ''}
      <div class="btn-row center">
        ${wa ? `<a class="btn btn-whatsapp" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        <button class="btn btn-primary" id="schedule">Agendar</button>
        <button class="btn btn-ghost" id="edit">Editar</button>
      </div>
    </section>

    <section class="stats">
      <div class="stat"><span class="stat-label">Atendimentos</span><strong>${done.length}</strong></div>
      <div class="stat"><span class="stat-label">Total gasto</span><strong>${money(spent)}</strong></div>
    </section>

    ${next ? `<p class="callout-line">Próximo horário: <strong>${fmtDate(next.starts_at)} às ${fmtTime(next.starts_at)}</strong></p>` : ''}

    <section>
      <h2>Histórico</h2>
      <div class="list">
        ${history.length ? history.map((a) => `
          <div class="row-item static">
            <span class="row-main">
              <strong>${esc(a.services?.name ?? 'Atendimento')}</strong>
              <small>${fmtDate(a.starts_at)} às ${fmtTime(a.starts_at)} • ${money(a.price)}</small>
            </span>
            <span class="badge badge-${a.status}">${STATUS_LABEL[a.status]}</span>
          </div>`).join('') : emptyState('Nenhum atendimento ainda.')}
      </div>
    </section>

    <button class="btn btn-link btn-danger-text" id="delete">Excluir cliente</button>`;

  const refresh = () => clientDetail(view, id, stillCurrent);
  view.querySelector('#schedule').addEventListener('click', () => openAppointmentForm({ clientId: id, onSaved: refresh }));
  view.querySelector('#edit').addEventListener('click', () => openClientForm({ client, onSaved: refresh }));
  view.querySelector('#delete').addEventListener('click', async () => {
    const ok = await confirmDialog(`Excluir ${client.name}? O histórico de atendimentos dela também será apagado.`,
      { confirmLabel: 'Excluir', danger: true });
    if (!ok) return;
    try {
      check(await db.from('clients').delete().eq('id', id));
      toast('Cliente excluída');
      location.hash = '#/clientes';
    } catch (err) { toast(err.message, 'error'); }
  });
}
