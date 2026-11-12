import { db, check } from '../supabase.js';
import { getSettings } from '../data.js';
import { openAppointmentForm } from '../appointments.js';
import { esc, isoDate, addDays, fmtDate, daysBetween, waLink, fillTemplate, emptyState, toast } from '../utils.js';

const TABS = [
  ['atrasados', 'Atrasados'],
  ['proximos', 'Próximos 7 dias'],
  ['agendados', 'Já agendaram'],
];

export default async function retornos(view, tab, stillCurrent) {
  const current = TABS.some(([k]) => k === tab) ? tab : 'atrasados';
  const [rows, settings] = await Promise.all([
    db.from('client_returns').select('*').not('return_due', 'is', null).order('return_due').then(check),
    getSettings(),
  ]);
  if (!stillCurrent()) return;

  const today = isoDate();
  const in7 = isoDate(addDays(new Date(), 7));
  const groups = {
    atrasados: rows.filter((r) => !r.has_next_appointment && r.return_due < today),
    proximos: rows.filter((r) => !r.has_next_appointment && r.return_due >= today && r.return_due <= in7),
    agendados: rows.filter((r) => r.has_next_appointment && r.return_due <= in7),
  };
  const list = groups[current];

  view.innerHTML = `
    <h1>Retornos</h1>
    <p class="muted">Calculados a partir do último atendimento concluído e do prazo de cada serviço.</p>
    <nav class="tabs">
      ${TABS.map(([k, label]) => `<a href="#/retornos/${k}" class="${k === current ? 'active' : ''}">${label}<i>${groups[k].length}</i></a>`).join('')}
    </nav>
    <div class="list" id="returns">
      ${list.length ? list.map((r) => returnCard(r, today, settings)).join('') : emptyState(
        current === 'atrasados' ? 'Nenhum retorno atrasado. 🎉'
          : current === 'proximos' ? 'Nenhum retorno previsto para os próximos dias.'
            : 'Nenhuma cliente com retorno próximo já agendada.')}
    </div>`;

  const refresh = () => retornos(view, current, stillCurrent);
  view.querySelectorAll('[data-schedule]').forEach((b) => b.addEventListener('click', () =>
    openAppointmentForm({ clientId: b.dataset.schedule, onSaved: refresh })));
  view.querySelectorAll('[data-reminded]').forEach((b) => b.addEventListener('click', async () => {
    try {
      check(await db.from('appointments').update({ return_reminded_at: new Date().toISOString() }).eq('id', b.dataset.reminded));
      toast('Marcado como avisada');
      refresh();
    } catch (err) { toast(err.message, 'error'); }
  }));
}

function returnCard(r, today, settings) {
  const diff = daysBetween(today, r.return_due);
  const when = diff < 0 ? `${-diff} dia${diff === -1 ? '' : 's'} de atraso`
    : diff === 0 ? 'Retorno hoje' : `Em ${diff} dia${diff === 1 ? '' : 's'}`;
  const message = fillTemplate(settings.return_message, {
    nome: r.client_name.trim().split(/\s+/)[0],
    servico: (r.service_name || 'unha').toLowerCase(),
  });
  const wa = waLink(r.phone, message);

  return `
    <article class="card return-card ${diff < 0 ? 'late' : ''}">
      <div class="return-head">
        <a href="#/clientes/${r.client_id}"><strong>${esc(r.client_name)}</strong></a>
        <span class="badge ${diff < 0 ? 'badge-faltou' : 'badge-agendado'}">${when}</span>
      </div>
      <p class="muted small">${esc(r.service_name || 'Atendimento')} em ${fmtDate(r.last_visit)} • previsto para ${fmtDate(r.return_due)}</p>
      ${r.return_reminded_at ? `<p class="small ok-text">✓ Avisada em ${fmtDate(r.return_reminded_at)}</p>` : ''}
      ${r.has_next_appointment ? '' : `
      <div class="btn-row">
        ${wa ? `<a class="btn btn-small btn-whatsapp" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : '<span class="muted small">Sem telefone</span>'}
        <button class="btn btn-small btn-primary" data-schedule="${r.client_id}">Agendar</button>
        ${r.return_reminded_at ? '' : `<button class="btn btn-small btn-ghost" data-reminded="${r.appointment_id}">Já avisei</button>`}
      </div>`}
    </article>`;
}
