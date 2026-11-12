import { db, check } from '../supabase.js';
import { getServices, SUGGESTED_SERVICES } from '../data.js';
import { esc, money, openForm, toast, confirmDialog, emptyState, parseMoney, moneyInput } from '../utils.js';

export default async function servicos(view, _param, stillCurrent) {
  const services = await getServices();
  if (!stillCurrent()) return;

  view.innerHTML = `
    <div class="section-head">
      <h1>Serviços</h1>
      <button class="btn btn-primary" id="new-service">+ Novo</button>
    </div>
    <p class="muted">O prazo de retorno define quando a cliente aparece na lista de retornos depois de um atendimento concluído.</p>
    <div class="list">
      ${services.length ? services.map((s) => `
        <div class="row-item ${s.active ? '' : 'inactive'}" data-id="${s.id}" role="button" tabindex="0">
          <span class="row-main">
            <strong>${esc(s.name)}${s.active ? '' : ' <small>(inativo)</small>'}</strong>
            <small>${s.duration_min} min • ${s.return_days ? `retorno em ${s.return_days} dias` : 'sem retorno'}</small>
          </span>
          <span class="amount">${money(s.price)}</span>
        </div>`).join('')
        : emptyState('Nenhum serviço cadastrado.', '<button class="btn btn-ghost" id="seed">Usar sugestões</button>')}
    </div>`;

  const refresh = () => servicos(view, null, stillCurrent);
  view.querySelector('#new-service').addEventListener('click', () => openServiceForm({ onSaved: refresh }));
  view.querySelector('#seed')?.addEventListener('click', async () => {
    try {
      check(await db.from('services').insert(SUGGESTED_SERVICES));
      toast('Serviços criados! Toque em cada um para ajustar o preço.');
      refresh();
    } catch (err) { toast(err.message, 'error'); }
  });
  view.querySelectorAll('[data-id]').forEach((row) => {
    const open = () => openServiceForm({ service: services.find((s) => s.id === row.dataset.id), onSaved: refresh });
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

function openServiceForm({ service: s = null, onSaved }) {
  openForm({
    title: s ? 'Editar serviço' : 'Novo serviço',
    extraActions: s ? '<button type="button" class="btn btn-ghost btn-danger-text" data-delete>Excluir</button>' : '',
    body: `
      <label>Nome<input name="name" required value="${esc(s?.name ?? '')}" placeholder="Ex.: Unha em gel" autocomplete="off"></label>
      <div class="row">
        <label>Duração (min)<input name="duration_min" type="number" min="5" step="5" required value="${s?.duration_min ?? 60}"></label>
        <label>Preço (R$)<input name="price" inputmode="decimal" required value="${moneyInput(s?.price ?? 0)}"></label>
      </div>
      <label>Retorno em quantos dias?<input name="return_days" type="number" min="1" value="${s?.return_days ?? ''}" placeholder="Deixe vazio se não tiver retorno"></label>
      <label class="check"><input type="checkbox" name="active" ${s && !s.active ? '' : 'checked'}> Serviço ativo</label>`,
    onOpen(form, close) {
      form.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const ok = await confirmDialog('Excluir este serviço? Os atendimentos antigos continuam no histórico, sem o nome do serviço. Se preferir, apenas desative.',
          { confirmLabel: 'Excluir', danger: true });
        if (!ok) return;
        try {
          check(await db.from('services').delete().eq('id', s.id));
          toast('Serviço excluído');
          close();
          onSaved?.();
        } catch (err) { toast(err.message, 'error'); }
      });
    },
    async onSubmit(v) {
      const price = parseMoney(v.price);
      if (Number.isNaN(price) || price < 0) throw new Error('Preço inválido.');
      const row = {
        name: v.name.trim(),
        duration_min: Number(v.duration_min),
        price,
        return_days: v.return_days ? Number(v.return_days) : null,
        active: v.active === 'on',
      };
      if (s) check(await db.from('services').update(row).eq('id', s.id));
      else check(await db.from('services').insert(row));
      toast('Serviço salvo');
      onSaved?.();
    },
  });
}
