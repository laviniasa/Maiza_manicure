import { db, check } from '../supabase.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../data.js';
import {
  esc, money, isoDate, parseDate, addDays, startOfMonth, endOfMonth, fmtMonth, fmtDate,
  openForm, toast, confirmDialog, emptyState, parseMoney, moneyInput,
} from '../utils.js';

/** Pagamentos não recebidos não entram no saldo. */
export function summarize(transactions) {
  const s = { income: 0, expenses: 0, pending: 0, pendingOut: 0 };
  for (const t of transactions) {
    const v = Number(t.amount);
    if (t.type === 'entrada') t.is_paid ? (s.income += v) : (s.pending += v);
    else t.is_paid ? (s.expenses += v) : (s.pendingOut += v);
  }
  s.balance = s.income - s.expenses;
  return s;
}

const FILTERS = [['todos', 'Tudo'], ['entrada', 'Entradas'], ['saida', 'Saídas'], ['pendente', 'Pendentes']];

export default async function caixa(view, param, stillCurrent, filter = 'todos') {
  const monthDate = param && /^\d{4}-\d{2}$/.test(param) ? parseDate(`${param}-01`) : startOfMonth(new Date());
  const from = isoDate(startOfMonth(monthDate));
  const to = isoDate(endOfMonth(monthDate));

  const transactions = check(await db.from('transactions').select('*')
    .gte('date', from).lte('date', to)
    .order('date', { ascending: false }).order('created_at', { ascending: false }));
  if (!stillCurrent()) return;

  const s = summarize(transactions);
  const monthKey = from.slice(0, 7);
  const prev = isoDate(addDays(startOfMonth(monthDate), -1)).slice(0, 7);
  const next = isoDate(addDays(endOfMonth(monthDate), 1)).slice(0, 7);

  view.innerHTML = `
    <div class="section-head">
      <h1>Caixa</h1>
    </div>
    <div class="month-nav">
      <a href="#/caixa/${prev}" class="icon-btn" aria-label="Mês anterior">‹</a>
      <strong class="cap">${esc(fmtMonth(monthDate))}</strong>
      <a href="#/caixa/${next}" class="icon-btn" aria-label="Próximo mês">›</a>
    </div>

    <section class="card balance">
      <span class="stat-label">Saldo do mês</span>
      <strong class="big ${s.balance < 0 ? 'neg' : ''}">${money(s.balance)}</strong>
      <div class="balance-split">
        <div><span><span class="dot dot-in"></span>Entradas</span><b>${money(s.income)}</b></div>
        <div><span><span class="dot dot-out"></span>Saídas</span><b>${money(s.expenses)}</b></div>
      </div>
      ${s.pending || s.pendingOut ? `<p class="small muted">
        ${s.pending ? `A receber: <b>${money(s.pending)}</b>` : ''}
        ${s.pending && s.pendingOut ? ' • ' : ''}
        ${s.pendingOut ? `A pagar: <b>${money(s.pendingOut)}</b>` : ''}
        <br>Valores pendentes não entram no saldo.</p>` : ''}
    </section>

    <div class="btn-row two">
      <button class="btn btn-in" data-new="entrada">+ Entrada</button>
      <button class="btn btn-out" data-new="saida">− Saída</button>
    </div>

    <nav class="chips">
      ${FILTERS.map(([k, l]) => `<button class="chip ${k === filter ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}
    </nav>
    <div class="list" id="tx-list"></div>`;

  const shown = transactions.filter((t) =>
    filter === 'todos' ? true : filter === 'pendente' ? !t.is_paid : t.type === filter);

  const listEl = view.querySelector('#tx-list');
  if (!shown.length) {
    listEl.innerHTML = emptyState('Nenhum lançamento neste período.');
  } else {
    let lastDate = null;
    listEl.innerHTML = shown.map((t) => {
      const header = t.date !== lastDate ? `<h3 class="date-head">${fmtDate(t.date)}</h3>` : '';
      lastDate = t.date;
      return `${header}
        <div class="row-item tx ${t.is_paid ? '' : 'pending'}" data-id="${t.id}" role="button" tabindex="0">
          <span class="row-main">
            <strong>${esc(t.description)}</strong>
            <small>${esc(t.category)}${t.is_paid ? '' : ` • ${t.type === 'entrada' ? 'a receber' : 'a pagar'}`}</small>
          </span>
          <span class="amount ${t.type}">${t.type === 'saida' ? '−' : '+'} ${money(t.amount)}</span>
          ${t.is_paid ? '' : `<button class="btn btn-small btn-ghost" data-settle="${t.id}">${t.type === 'entrada' ? 'Recebi' : 'Paguei'}</button>`}
        </div>`;
    }).join('');
  }

  const refresh = (f = filter) => caixa(view, monthKey, stillCurrent, f);
  const defaultDate = monthKey === isoDate().slice(0, 7) ? isoDate() : from;

  view.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => refresh(b.dataset.filter)));
  view.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () =>
    openTransactionForm({ type: b.dataset.new, date: defaultDate, onSaved: () => refresh() })));
  view.querySelectorAll('[data-settle]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      check(await db.from('transactions').update({ is_paid: true }).eq('id', b.dataset.settle));
      toast('Lançamento confirmado');
      refresh();
    } catch (err) { toast(err.message, 'error'); }
  }));
  view.querySelectorAll('.tx').forEach((row) => {
    const open = () => openTransactionForm({
      transaction: transactions.find((t) => t.id === row.dataset.id),
      onSaved: () => refresh(),
    });
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

function openTransactionForm({ transaction: t = null, type, date, onSaved }) {
  const kind = t?.type ?? type;
  const categories = kind === 'entrada' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const cats = t && !categories.includes(t.category) ? [...categories, t.category] : categories;

  openForm({
    title: `${t ? 'Editar' : 'Nova'} ${kind === 'entrada' ? 'entrada' : 'saída'}`,
    extraActions: t ? '<button type="button" class="btn btn-ghost btn-danger-text" data-delete>Excluir</button>' : '',
    body: `
      <label>Descrição<input name="description" required value="${esc(t?.description ?? '')}"
        placeholder="${kind === 'entrada' ? 'Ex.: Venda de esmalte' : 'Ex.: Compra de materiais'}" autocomplete="off"></label>
      <div class="row">
        <label>Valor (R$)<input name="amount" inputmode="decimal" required value="${t ? moneyInput(t.amount) : ''}" placeholder="0,00"></label>
        <label>Data<input name="date" type="date" required value="${t?.date ?? date}"></label>
      </div>
      <label>Categoria
        <select name="category">${cats.map((c) => `<option ${c === (t?.category ?? cats[0]) ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </label>
      <label class="check"><input type="checkbox" name="is_paid" ${t ? (t.is_paid ? 'checked' : '') : 'checked'}>
        ${kind === 'entrada' ? 'Já recebi este valor' : 'Já paguei este valor'}</label>
      ${t?.appointment_id ? '<p class="small muted">Lançamento ligado a um atendimento.</p>' : ''}`,
    onOpen(form, close) {
      form.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!(await confirmDialog('Excluir este lançamento?', { confirmLabel: 'Excluir', danger: true }))) return;
        try {
          check(await db.from('transactions').delete().eq('id', t.id));
          toast('Lançamento excluído');
          close();
          onSaved?.();
        } catch (err) { toast(err.message, 'error'); }
      });
    },
    async onSubmit(v) {
      const amount = parseMoney(v.amount);
      if (!(amount > 0)) throw new Error('Informe um valor maior que zero.');
      const row = {
        type: kind,
        description: v.description.trim(),
        amount,
        date: v.date,
        category: v.category,
        is_paid: v.is_paid === 'on',
      };
      if (t) check(await db.from('transactions').update(row).eq('id', t.id));
      else check(await db.from('transactions').insert(row));
      toast('Lançamento salvo');
      onSaved?.();
    },
  });
}
