import { api, qs } from '../api.js';
import { getServices, SUGGESTED_SERVICES } from '../data.js';
import { appointmentCard, bindAppointmentCards, openAppointmentForm } from '../appointments.js';
import { esc, money, isoDate, addDays, startOfMonth, endOfMonth, fmtLongDate, emptyState, toast } from '../utils.js';
import { summarize } from './caixa.js';
import { icon } from '../icons.js';

export default async function inicio(view, _param, stillCurrent) {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = addDays(dayStart, 1);
  const today = isoDate(now);

  const [appointments, returns, transactions, services] = await Promise.all([
    api('/appointments' + qs({ from: dayStart.toISOString(), to: dayEnd.toISOString(), exclude_cancelled: 1 })),
    api('/returns').then((rows) => rows.filter((r) => !r.has_next_appointment && r.return_due <= isoDate(addDays(now, 7)))),
    api('/transactions' + qs({ from: isoDate(startOfMonth(now)), to: isoDate(endOfMonth(now)) })),
    getServices(),
  ]);
  if (!stillCurrent()) return;

  const overdue = returns.filter((r) => r.return_due < today).length;
  const upcoming = returns.length - overdue;
  const month = summarize(transactions);
  const pendingToday = appointments.filter((a) => a.status === 'agendado').length;
  const greeting = now.getHours() < 12 ? 'Bom dia' : now.getHours() < 18 ? 'Boa tarde' : 'Boa noite';

  view.innerHTML = `
    <section class="hero">
      <p class="eyebrow">${esc(fmtLongDate(now))}</p>
      <h1>${greeting}<span class="accent">!</span></h1>
      <p class="muted">${appointments.length
        ? `${appointments.length} atendimento${appointments.length > 1 ? 's' : ''} hoje${pendingToday ? `, ${pendingToday} a concluir` : ''}.`
        : 'Nenhum atendimento marcado para hoje.'}</p>
    </section>

    ${services.length ? '' : `
    <section class="card callout">
      <h2>Comece cadastrando seus serviços</h2>
      <p class="muted">Eles definem duração, preço e prazo de retorno de cada atendimento.</p>
      <div class="btn-row">
        <button class="btn btn-primary" id="seed-services">Usar sugestões</button>
        <a class="btn btn-ghost" href="#/servicos">Cadastrar do zero</a>
      </div>
    </section>`}

    <section class="stats">
      <a class="stat" href="#/retornos">
        <span class="stat-label">Retornos atrasados</span>
        <strong class="${overdue ? 'warn' : ''}">${overdue}</strong>
        <span class="stat-foot">${upcoming} nos próximos 7 dias</span>
      </a>
      <a class="stat" href="#/caixa">
        <span class="stat-label">Saldo do mês</span>
        <strong class="${month.balance < 0 ? 'neg' : ''}">${money(month.balance)}</strong>
        <span class="stat-foot">${month.pending ? `${money(month.pending)} a receber` : 'Nada a receber'}</span>
      </a>
    </section>

    <section>
      <div class="section-head">
        <h2>Hoje</h2>
        <button class="btn btn-small btn-primary" id="new-appt">+ Agendar</button>
      </div>
      <div class="list" id="today">
        ${appointments.length ? appointments.map((a) => appointmentCard(a)).join('') : emptyState('Agenda livre hoje.')}
      </div>
    </section>

    <section class="shortcuts">
      ${[['agenda', 'Agenda'], ['clientes', 'Clientes'], ['retornos', 'Retornos'], ['caixa', 'Caixa']]
        .map(([k, l]) => `<a href="#/${k}" class="shortcut"><i>${icon(k)}</i><span>${l}</span></a>`).join('')}
    </section>`;

  const refresh = () => inicio(view, null, stillCurrent);
  bindAppointmentCards(view.querySelector('#today'), appointments, refresh);
  view.querySelector('#new-appt').addEventListener('click', () => openAppointmentForm({ date: today, onSaved: refresh }));
  view.querySelector('#seed-services')?.addEventListener('click', async () => {
    try {
      await api('/services', { method: 'POST', body: SUGGESTED_SERVICES });
      toast('Serviços criados! Ajuste os preços em Serviços.');
      location.hash = '#/servicos';
    } catch (err) { toast(err.message, 'error'); }
  });
}
