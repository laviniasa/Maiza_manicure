// Teste de ponta a ponta da API. Uso: BASE=http://localhost:3100 node test/api-test.mjs
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:3100';
let cookie = '';

async function call(method, path, body, { csrf = true } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(csrf && { 'X-Requested-With': 'fetch' }),
      ...(cookie && { Cookie: cookie }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json() };
}
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };

const tz = (date, time) => new Date(`${date}T${time}:00-03:00`).toISOString();
let step = 0;
const log = (m) => console.log(`✓ ${++step}. ${m}`);

assert.equal((await call('GET', '/me')).status, 401); log('sem login -> 401');
assert.equal((await call('POST', '/login', { email: 'maiza@teste.com', password: 'errada' })).status, 401); log('senha errada -> 401');
assert.equal((await call('POST', '/clients', { name: 'x' }, { csrf: false })).status, 403); log('sem cabeçalho CSRF -> 403');
await ok('POST', '/login', { email: 'Maiza@teste.com', password: 'senha12345' }); log('login');
assert.equal((await ok('GET', '/me')).email, 'maiza@teste.com'); log('/me');

const settings = await ok('GET', '/settings'); assert.equal(settings.business_name, 'Meu Studio'); log('settings padrão');
await ok('PUT', '/settings', { business_name: 'Maiza Nails', return_message: 'Oi {nome}' }); log('settings salvo');

const [gel, pe] = await ok('POST', '/services', [
  { name: 'Unha em gel', duration_min: 120, price: 150, return_days: 20 },
  { name: 'Pé e mão', duration_min: 90, price: 70, return_days: 7 },
]);
assert.equal(gel.price, 150); log('serviços criados (lote)');

const ana = await ok('POST', '/clients', { name: 'Ana', phone: '11912345678', whatsapp_opt_in: true });
const bia = await ok('POST', '/clients', { name: 'Bia', phone: '' });
assert.equal(bia.phone, null); log('clientes criadas');

const a1 = await ok('POST', '/appointments', { client_id: ana.id, service_id: gel.id, starts_at: tz('2026-10-28', '14:00'), duration_min: 120, price: 150 });
assert.equal(a1.status, 'agendado'); log('agendamento criado');

const conflict = await call('POST', '/appointments', { client_id: bia.id, starts_at: tz('2026-10-28', '15:00'), duration_min: 60, price: 0 });
assert.equal(conflict.status, 409); assert.match(conflict.data.error, /14:00 com Ana/); log(`conflito bloqueado: "${conflict.data.error}"`);

await ok('POST', '/appointments', { client_id: bia.id, starts_at: tz('2026-10-28', '16:00'), duration_min: 60, price: 70 });
log('horário encostado (16:00) permitido');

const done = await ok('POST', `/appointments/${a1.id}/complete`, { price: 160, paid: false });
assert.equal(done.status, 'concluido'); assert.equal(done.return_due, '2026-11-17'); log('concluído, retorno em 17/11/2026');

let tx = await ok('GET', '/transactions?from=2026-10-01&to=2026-10-31');
assert.equal(tx.length, 1); assert.equal(tx[0].amount, 160); assert.equal(tx[0].is_paid, false);
assert.equal(tx[0].description, 'Unha em gel - Ana'); log('entrada a receber lançada no caixa');

await ok('POST', `/appointments/${a1.id}/complete`, { price: 160, paid: true });
tx = await ok('GET', '/transactions?from=2026-10-01&to=2026-10-31');
assert.equal(tx.length, 1); assert.equal(tx[0].is_paid, true); log('concluir de novo não duplica lançamento');

let ret = await ok('GET', '/returns');
assert.equal(ret.length, 1); assert.equal(ret[0].has_next_appointment, false); log('aparece em retornos');

await ok('POST', '/appointments', { client_id: ana.id, service_id: gel.id, starts_at: tz('2026-11-17', '10:00'), duration_min: 120, price: 150 });
ret = await ok('GET', '/returns'); assert.equal(ret[0].has_next_appointment, true); log('reagendou -> marcada como já agendada');

await ok('POST', `/appointments/${a1.id}/reminded`); ret = await ok('GET', '/returns');
assert.ok(ret[0].return_reminded_at); log('marcar como avisada');

const edited = await ok('PUT', `/appointments/${a1.id}`, { client_id: ana.id, service_id: gel.id, starts_at: tz('2026-10-28', '14:00'), duration_min: 120, price: 180, status: 'concluido' });
tx = await ok('GET', '/transactions?from=2026-10-01&to=2026-10-31'); assert.equal(tx[0].amount, 180); log('editar valor atualiza o caixa');

await ok('POST', `/appointments/${a1.id}/status`, { status: 'cancelado' });
tx = await ok('GET', '/transactions?from=2026-10-01&to=2026-10-31'); assert.equal(tx.length, 0); log('cancelar remove lançamento');

const t = await ok('POST', '/transactions', { type: 'saida', description: 'Esmaltes', category: 'Material', amount: 86.5, date: '2026-11-12', is_paid: true });
await ok('PUT', `/transactions/${t.id}`, { is_paid: false });
assert.equal((await call('POST', '/transactions', { type: 'saida', description: 'x', category: 'Outros', amount: 0, date: '2026-11-12' })).status, 400);
log('caixa: criar, editar e validar valor zero');

const appts = await ok('GET', `/appointments?client_id=${ana.id}&order=desc`);
assert.equal(appts[0].clients.name, 'Ana'); assert.equal(appts[0].services.name, 'Unha em gel'); log('lista com cliente e serviço');

assert.equal((await call('GET', '/clients/nao-e-uuid')).status, 400); log('id inválido -> 400');
assert.equal((await call('POST', '/appointments', { client_id: '00000000-0000-0000-0000-000000000000', starts_at: tz('2026-12-01', '10:00'), duration_min: 60, price: 0 })).status, 400);
log('cliente de outra conta/inexistente -> 400');

await ok('POST', '/password', { password: 'novasenha123' }); await ok('GET', '/me'); log('trocar senha mantém esta sessão');
await ok('POST', '/logout'); assert.equal((await call('GET', '/me')).status, 401); log('logout');
await ok('POST', '/login', { email: 'maiza@teste.com', password: 'novasenha123' }); log('login com a nova senha');
await ok('POST', '/password', { password: 'senha12345' });

const page = await fetch(BASE + '/'); assert.equal(page.status, 200); assert.ok(page.headers.get('content-security-policy'));
assert.equal((await fetch(BASE + '/..%2fpackage.json')).status, 403); log('site servido, com proteção de caminho');

console.log('\nTodos os testes passaram.');
