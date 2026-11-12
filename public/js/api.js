/** Chamada à API do servidor. Lança Error com mensagem amigável. */
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'fetch',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
  }

  let data = null;
  try { data = await res.json(); } catch { /* resposta sem JSON */ }

  if (res.status === 401 && path !== '/login') {
    window.dispatchEvent(new Event('auth:expired'));
  }
  if (!res.ok) {
    throw new Error(data?.error || (res.status >= 500 ? 'Erro no servidor. Tente de novo.' : 'Não foi possível concluir.'));
  }
  return data;
}

export const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  return s ? `?${s}` : '';
};
