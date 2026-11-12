import { db, check } from '../supabase.js';
import { APPT_SELECT, appointmentCard, bindAppointmentCards, openAppointmentForm } from '../appointments.js';
import {
  esc, isoDate, parseDate, addDays, startOfMonth, endOfMonth, fmtMonth, fmtLongDate, emptyState, money,
} from '../utils.js';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export default async function agenda(view, param, stillCurrent) {
  const selected = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : isoDate();
  const selDate = parseDate(selected);
  const monthStart = startOfMonth(selDate);
  const monthEnd = endOfMonth(selDate);

  const appointments = check(await db.from('appointments').select(APPT_SELECT)
    .gte('starts_at', monthStart.toISOString())
    .lt('starts_at', addDays(monthEnd, 1).toISOString())
    .order('starts_at'));
  if (!stillCurrent()) return;

  const byDay = new Map();
  for (const a of appointments) {
    const key = isoDate(new Date(a.starts_at));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(a);
  }

  const today = isoDate();
  const cells = [];
  for (let i = 0; i < monthStart.getDay(); i++) cells.push('<span class="cal-cell empty-cell"></span>');
  for (let d = 1; d <= monthEnd.getDate(); d++) {
    const key = isoDate(new Date(selDate.getFullYear(), selDate.getMonth(), d));
    const active = (byDay.get(key) || []).filter((a) => a.status !== 'cancelado').length;
    cells.push(`
      <a href="#/agenda/${key}" class="cal-cell ${key === selected ? 'selected' : ''} ${key === today ? 'today' : ''}">
        <span>${d}</span>${active ? `<i class="cal-count">${active}</i>` : ''}
      </a>`);
  }

  const dayList = byDay.get(selected) || [];
  const dayTotal = dayList.filter((a) => a.status !== 'cancelado' && a.status !== 'faltou')
    .reduce((s, a) => s + Number(a.price), 0);
  const prevMonth = isoDate(startOfMonth(addDays(monthStart, -1)));
  const nextMonth = isoDate(addDays(monthEnd, 1));

  view.innerHTML = `
    <div class="section-head">
      <h1>Agenda</h1>
      <button class="btn btn-primary" id="new-appt">+ Agendar</button>
    </div>

    <section class="card calendar">
      <div class="cal-head">
        <a href="#/agenda/${prevMonth}" class="icon-btn" aria-label="Mês anterior">‹</a>
        <strong>${esc(fmtMonth(selDate))}</strong>
        <a href="#/agenda/${nextMonth}" class="icon-btn" aria-label="Próximo mês">›</a>
      </div>
      <div class="cal-grid">
        ${WEEKDAYS.map((w) => `<span class="cal-weekday">${w}</span>`).join('')}
        ${cells.join('')}
      </div>
      ${selected !== today ? `<a href="#/agenda/${today}" class="btn btn-link">Ir para hoje</a>` : ''}
    </section>

    <section>
      <div class="section-head">
        <h2 class="cap">${esc(fmtLongDate(selDate))}</h2>
        ${dayTotal ? `<span class="muted">${money(dayTotal)}</span>` : ''}
      </div>
      <div class="list" id="day-list">
        ${dayList.length ? dayList.map((a) => appointmentCard(a)).join('') : emptyState('Nenhum horário neste dia.')}
      </div>
    </section>`;

  const refresh = () => agenda(view, selected, stillCurrent);
  bindAppointmentCards(view.querySelector('#day-list'), dayList, refresh);
  view.querySelector('#new-appt').addEventListener('click', () =>
    openAppointmentForm({ date: selected < today ? today : selected, onSaved: refresh }));
}
