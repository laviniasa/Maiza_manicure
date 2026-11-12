import { api } from './api.js';

let settingsCache = null;
let userCache = null;

export async function getUser() {
  if (!userCache) userCache = await api('/me');
  return userCache;
}

export async function getSettings({ fresh = false } = {}) {
  if (!settingsCache || fresh) settingsCache = await api('/settings');
  return settingsCache;
}

export async function saveSettings(values) {
  settingsCache = await api('/settings', { method: 'PUT', body: values });
  return settingsCache;
}

export function clearCache() {
  settingsCache = null;
  userCache = null;
}

export async function getServices({ onlyActive = false } = {}) {
  const list = await api('/services');
  return onlyActive ? list.filter((s) => s.active) : list;
}

export const getClients = () => api('/clients');

export const SUGGESTED_SERVICES = [
  { name: 'Mão', duration_min: 45, price: 0, return_days: 7 },
  { name: 'Pé', duration_min: 45, price: 0, return_days: 15 },
  { name: 'Pé e mão', duration_min: 90, price: 0, return_days: 7 },
  { name: 'Esmaltação em gel', duration_min: 60, price: 0, return_days: 15 },
  { name: 'Unha em gel', duration_min: 120, price: 0, return_days: 20 },
  { name: 'Manutenção de gel', duration_min: 90, price: 0, return_days: 20 },
];

export const EXPENSE_CATEGORIES = ['Material', 'Aluguel', 'Contas', 'Transporte', 'Divulgação', 'Pessoal', 'Outros'];
export const INCOME_CATEGORIES = ['Atendimento', 'Venda de produto', 'Outros'];

export const STATUS_LABEL = {
  agendado: 'Agendado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
  faltou: 'Faltou',
};
