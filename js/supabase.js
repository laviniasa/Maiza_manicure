import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const db = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

/** Lança erro amigável quando a consulta falha. */
export function check({ data, error }) {
  if (error) throw friendlyError(error);
  return data;
}

export function friendlyError(error) {
  const msg = error?.message || String(error);
  if (error?.code === '23P01' || msg.includes('appointments_no_overlap')) {
    return new Error('Já existe um horário marcado nesse período.');
  }
  if (msg.includes('Invalid login credentials')) {
    return new Error('E-mail ou senha incorretos.');
  }
  if (msg.includes('Failed to fetch')) {
    return new Error('Sem conexão com a internet. Tente de novo.');
  }
  return new Error(msg);
}
