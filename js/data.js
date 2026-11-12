import { db, check } from './supabase.js';

let settingsCache = null;

export async function getUser() {
  const { data } = await db.auth.getUser();
  return data.user;
}

export async function getSettings({ fresh = false } = {}) {
  if (settingsCache && !fresh) return settingsCache;
  let row = check(await db.from('settings').select('*').maybeSingle());
  if (!row) row = check(await db.from('settings').insert({}).select().single());
  settingsCache = row;
  return row;
}

export async function saveSettings(values) {
  const user = await getUser();
  settingsCache = check(
    await db.from('settings').upsert({ user_id: user.id, ...values }).select().single(),
  );
  return settingsCache;
}

export function clearCache() {
  settingsCache = null;
}

export async function getServices({ onlyActive = false } = {}) {
  let q = db.from('services').select('*').order('name');
  if (onlyActive) q = q.eq('active', true);
  return check(await q);
}

export async function getClients() {
  return check(await db.from('clients').select('id, name, phone').order('name'));
}

export const SUGGESTED_SERVICES = [
  { name: 'Mão', duration_min: 45, return_days: 7 },
  { name: 'Pé', duration_min: 45, return_days: 15 },
  { name: 'Pé e mão', duration_min: 90, return_days: 7 },
  { name: 'Esmaltação em gel', duration_min: 60, return_days: 15 },
  { name: 'Unha em gel', duration_min: 120, return_days: 20 },
  { name: 'Manutenção de gel', duration_min: 90, return_days: 20 },
];

export const EXPENSE_CATEGORIES = ['Material', 'Aluguel', 'Contas', 'Transporte', 'Divulgação', 'Pessoal', 'Outros'];
export const INCOME_CATEGORIES = ['Atendimento', 'Venda de produto', 'Outros'];

export const STATUS_LABEL = {
  agendado: 'Agendado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  faltou: 'Faltou',
};
