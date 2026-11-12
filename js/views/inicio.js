import { db, check } from '../supabase.js';
import { getServices, SUGGESTED_SERVICES } from '../data.js';
import { APPT_SELECT, appointmentCard, bindAppointmentCards, openAppointmentForm } from '../appointments.js';
import { esc, money, isoDate, addDays, startOfMonth, endOfMonth, fmtLongDate, emptyState, toast } from '../utils.js';
import { summarize } from './caixa.js';

export default async function inicio(view, _param, stillCurrent) {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = addDays(dayStart, 1);
  const today = isoDate(now);

  const [appointments, returns, transactions, services] = await Promise.all([
    db.from('appointments').select(APPT_SELECT)
      .gte('starts_at', dayStart.toISOString()).lt('starts_at', dayEnd.toISOString())
      .neq('status', 'cancelado').order('starts_at').then(check),
    db.from('client_returns').select('client_id, return_due, has_next_appointment')
      .not('return_due', 'is', null).eq('has_next_appointment', false)
      .lte('return_due', isoDate(addDays(now, 7))).then(check),
    db.from('transactions').select('type, amount, is_paid')
      .gte('date', isoDate(startOfMonth(now))).lte('date', isoDate(endOfMonth(now))).then(check),
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
      <h1>${greeting}!</h1>
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
        <span class="stat-foot">${month.pending ? `${money(month.pending)} a receber` : 'Nada pendente'}</span>
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
      <a href="#/agenda" class="shortcut">📅<span>Agenda</span></a>
      <a href="#/clientes" class="shortcut">👩<span>Clientes</span></a>
      <a href="#/retornos" class="shortcut">🔁<span>Retornos</span></a>
      <a href="#/caixa" class="shortcut">💰<span>Caixa</span></a>
    </section>`;

  const refresh = () => inicio(view, null, stillCurrent);
  bindAppointmentCards(view.querySelector('#today'), appointments, refresh);
  view.querySelector('#new-appt').addEventListener('click', () => openAppointmentForm({ date: today, onSaved: refresh }));
  view.querySelector('#seed-services')?.addEventListener('click', async () => {
    try {
      check(await db.from('services').insert(SUGGESTED_SERVICES));
      toast('Serviços criados! Ajuste os preços em Serviços.');
      location.hash = '#/servicos';
    } catch (err) { toast(err.message, 'error'); }
  });
}
