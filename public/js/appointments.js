import { api } from './api.js';
import { getServices, getClients, STATUS_LABEL } from './data.js';
import {
  esc, openForm, toast, isoDate, timeInput, parseMoney, moneyInput, money, confirmDialog,
} from './utils.js';

/** Formulário para criar ou editar um agendamento. */
export async function openAppointmentForm({ appointment = null, date = null, clientId = null, onSaved } = {}) {
  const [services, clients] = await Promise.all([getServices(), getClients()]);
  const a = appointment;
  const start = a ? new Date(a.starts_at) : null;
  const selectedClient = a?.client_id ?? clientId ?? '';
  const activeServices = services.filter((s) => s.active || s.id === a?.service_id);

  const body = `
    <label>Cliente
      <select name="client_id" required>
        <option value="">Selecione…</option>
        <option value="__new">+ Nova cliente</option>
        ${clients.map((c) => `<option value="${c.id}" ${c.id === selectedClient ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
    </label>
    <div class="new-client" hidden>
      <label>Nome da nova cliente<input name="new_name" autocomplete="off"></label>
      <label>Telefone (WhatsApp)<input name="new_phone" type="tel" inputmode="tel" placeholder="(11) 91234-5678"></label>
    </div>
    <label>Serviço
      <select name="service_id">
        <option value="">Outro / sem serviço</option>
        ${activeServices.map((s) => `<option value="${s.id}" data-duration="${s.duration_min}" data-price="${s.price}" ${s.id === a?.service_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
    </label>
    <div class="row">
      <label>Data<input name="date" type="date" required value="${start ? isoDate(start) : (date || isoDate())}"></label>
      <label>Horário<input name="time" type="time" required step="300" value="${start ? timeInput(start) : ''}"></label>
    </div>
    <div class="row">
      <label>Duração (min)<input name="duration_min" type="number" min="5" step="5" required value="${a?.duration_min ?? 60}"></label>
      <label>Valor (R$)<input name="price" inputmode="decimal" required value="${moneyInput(a?.price ?? 0)}"></label>
    </div>
    ${a ? `
    <label>Situação
      <select name="status">
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === a.status ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </label>` : ''}
    <label>Observações<textarea name="notes" rows="2">${esc(a?.notes ?? '')}</textarea></label>`;

  openForm({
    title: a ? 'Editar horário' : 'Novo horário',
    body,
    extraActions: a ? '<button type="button" class="btn btn-ghost btn-danger-text" data-delete>Excluir</button>' : '',
    onOpen(form, close) {
      const clientSel = form.client_id;
      const newBox = form.querySelector('.new-client');
      const toggleNew = () => {
        const isNew = clientSel.value === '__new';
        newBox.hidden = !isNew;
        form.new_name.required = isNew;
        if (isNew) form.new_name.focus();
      };
      clientSel.addEventListener('change', toggleNew);

      form.service_id.addEventListener('change', () => {
        const opt = form.service_id.selectedOptions[0];
        if (opt?.dataset.duration) form.duration_min.value = opt.dataset.duration;
        if (opt?.dataset.price) form.price.value = moneyInput(opt.dataset.price);
      });

      form.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!(await confirmDialog('Excluir este horário? Esta ação não pode ser desfeita.', { confirmLabel: 'Excluir', danger: true }))) return;
        try {
          await api(`/appointments/${a.id}`, { method: 'DELETE' });
          toast('Horário excluído');
          close();
          onSaved?.();
        } catch (err) { toast(err.message, 'error'); }
      });
    },
    async onSubmit(v) {
      const price = parseMoney(v.price);
      if (Number.isNaN(price) || price < 0) throw new Error('Valor inválido.');
      const duration = Number(v.duration_min);
      const startsAt = new Date(`${v.date}T${v.time}`);
      if (Number.isNaN(startsAt.getTime())) throw new Error('Data ou horário inválido.');
      const status = v.status || 'agendado';

      let clientIdToUse = v.client_id;
      let createdClientId = null;
      if (clientIdToUse === '__new') {
        if (!v.new_name.trim()) throw new Error('Informe o nome da nova cliente.');
        const c = await api('/clients', { method: 'POST', body: { name: v.new_name.trim(), phone: v.new_phone.trim() || null } });
        clientIdToUse = createdClientId = c.id;
      }

      const row = {
        client_id: clientIdToUse,
        service_id: v.service_id || null,
        starts_at: startsAt.toISOString(),
        duration_min: duration,
        price,
        notes: v.notes.trim() || null,
        status,
      };

      try {
        if (a) await api(`/appointments/${a.id}`, { method: 'PUT', body: row });
        else await api('/appointments', { method: 'POST', body: row });
      } catch (err) {
        if (createdClientId) await api(`/clients/${createdClientId}`, { method: 'DELETE' }).catch(() => {});
        throw err;
      }
      toast(a ? 'Horário atualizado' : 'Horário agendado');
      onSaved?.();
    },
  });
}

/** Conclui o atendimento e lança a entrada no caixa (recebida ou a receber). */
export function completeAppointment(appt, onDone) {
  const label = [appt.services?.name, appt.clients?.name].filter(Boolean).join(' - ') || 'Atendimento';
  openForm({
    title: 'Concluir atendimento',
    submitLabel: 'Concluir',
    body: `
      <p class="muted">${esc(label)}</p>
      <label>Valor cobrado (R$)<input name="price" inputmode="decimal" required value="${moneyInput(appt.price)}"></label>
      <fieldset class="choice">
        <legend>Pagamento</legend>
        <label class="radio"><input type="radio" name="paid" value="yes" checked> Já recebi</label>
        <label class="radio"><input type="radio" name="paid" value="no"> Vai pagar depois</label>
      </fieldset>`,
    async onSubmit(v) {
      const price = parseMoney(v.price);
      if (Number.isNaN(price) || price < 0) throw new Error('Valor inválido.');
      await api(`/appointments/${appt.id}/complete`, { method: 'POST', body: { price, paid: v.paid === 'yes' } });
      toast(v.paid === 'yes' ? `Concluído • ${money(price)} no caixa` : 'Concluído • valor a receber');
      onDone?.();
    },
  });
}

export async function setAppointmentStatus(appt, status, onDone) {
  try {
    await api(`/appointments/${appt.id}/status`, { method: 'POST', body: { status } });
    toast(`Marcado como ${STATUS_LABEL[status].toLowerCase()}`);
    onDone?.();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** Cartão de agendamento usado na agenda e no painel. */
export function appointmentCard(a, { showDate = false } = {}) {
  const start = new Date(a.starts_at);
  const time = start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const date = showDate ? start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' • ' : '';
  return `
    <article class="appt status-${a.status}" data-id="${a.id}">
      <div class="appt-time">${date}${time}<small>${a.duration_min} min</small></div>
      <div class="appt-info">
        <strong>${esc(a.clients?.name ?? 'Cliente')}</strong>
        <span>${esc(a.services?.name ?? 'Atendimento')} • ${money(a.price)}</span>
        <span class="badge badge-${a.status}">${STATUS_LABEL[a.status]}</span>
      </div>
      <div class="appt-actions">
        ${a.status === 'agendado' ? '<button class="btn btn-small btn-primary" data-act="complete">Concluir</button>' : ''}
        <button class="icon-btn" data-act="menu" aria-label="Mais opções">⋯</button>
      </div>
    </article>`;
}

/** Liga os botões dos cartões de agendamento dentro de um container. */
export function bindAppointmentCards(container, appointments, refresh) {
  container.querySelectorAll('.appt').forEach((card) => {
    const appt = appointments.find((x) => x.id === card.dataset.id);
    card.querySelector('[data-act=complete]')?.addEventListener('click', () => completeAppointment(appt, refresh));
    card.querySelector('[data-act=menu]').addEventListener('click', () => appointmentMenu(appt, refresh));
  });
}

function appointmentMenu(appt, refresh) {
  const actions = [
    ['edit', 'Editar / remarcar'],
    ...(appt.status === 'agendado' ? [['faltou', 'Marcar falta'], ['cancelado', 'Cancelar horário']] : []),
    ...(appt.status !== 'agendado' ? [['agendado', 'Voltar para agendado']] : []),
    ['client', 'Ver cliente'],
  ];
  const { form, close } = openForm({
    title: appt.clients?.name ?? 'Horário',
    submitLabel: 'Fechar',
    body: `<div class="menu-list">${actions.map(([k, label]) => `<button type="button" class="menu-item" data-k="${k}">${label}</button>`).join('')}</div>`,
    onSubmit: async () => {},
  });
  form.querySelector('.modal-foot [data-close]').remove();
  form.querySelectorAll('.menu-item').forEach((btn) => btn.addEventListener('click', () => {
    close();
    const k = btn.dataset.k;
    if (k === 'edit') openAppointmentForm({ appointment: appt, onSaved: refresh });
    else if (k === 'client') location.hash = `#/clientes/${appt.client_id}`;
    else setAppointmentStatus(appt, k, refresh);
  }));
}
