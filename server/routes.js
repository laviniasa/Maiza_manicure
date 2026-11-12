import { query, one } from './db.js';
import {
  hashPassword, verifyPassword, setSessionCookie, clearSessionCookie, tooManyAttempts, recordFailure,
} from './auth.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- Validação ----------
const str = (max = 500) => (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (s.length > max) throw new HttpError(400, 'Texto muito longo.');
  return s || null;
};
const required = (fn) => (v, key) => {
  const r = fn(v, key);
  if (r == null || r === '') throw new HttpError(400, `Campo obrigatório: ${key}.`);
  return r;
};
const num = ({ min = 0, int = false } = {}) => (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || (int && !Number.isInteger(n))) throw new HttpError(400, 'Número inválido.');
  return int ? n : Math.round(n * 100) / 100;
};
const bool = (v) => v === true || v === 'true' || v === 'on';
const oneOf = (...opts) => (v) => {
  if (!opts.includes(v)) throw new HttpError(400, 'Valor inválido.');
  return v;
};
const uuid = (v) => {
  if (v == null || v === '') return null;
  if (!UUID.test(v)) throw new HttpError(400, 'Identificador inválido.');
  return v;
};
const date = (v) => {
  if (!DATE.test(String(v))) throw new HttpError(400, 'Data inválida.');
  return v;
};
const timestamp = (v) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Data ou horário inválido.');
  return d.toISOString();
};

/** Valida o corpo; com partial=true só considera campos enviados. */
function pick(body, spec, { partial = false } = {}) {
  const out = {};
  for (const [key, fn] of Object.entries(spec)) {
    if (partial && !(key in body)) continue;
    out[key] = fn(body[key], key);
  }
  return out;
}

function insertSql(table, row, userId) {
  const cols = ['user_id', ...Object.keys(row)];
  const vals = [userId, ...Object.values(row)];
  return {
    text: `insert into ${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    values: vals,
  };
}

function updateSql(table, row, id, userId) {
  const cols = Object.keys(row);
  if (!cols.length) throw new HttpError(400, 'Nada para atualizar.');
  return {
    text: `update ${table} set ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}
           where id = $1 and user_id = $2 returning *`,
    values: [id, userId, ...Object.values(row)],
  };
}

const found = (row) => { if (!row) throw new HttpError(404, 'Registro não encontrado.'); return row; };

// ---------- Especificações dos campos ----------
const SERVICE = {
  name: required(str(120)),
  duration_min: required(num({ min: 5, int: true })),
  price: required(num()),
  return_days: num({ min: 1, int: true }),
  active: bool,
};
const CLIENT = {
  name: required(str(120)),
  phone: str(40),
  notes: str(2000),
  whatsapp_opt_in: bool,
};
const STATUSES = ['agendado', 'concluido', 'cancelado', 'faltou'];
const APPOINTMENT = {
  client_id: required(uuid),
  service_id: uuid,
  starts_at: required(timestamp),
  duration_min: required(num({ min: 5, int: true })),
  price: required(num()),
  status: (v) => (v == null ? 'agendado' : oneOf(...STATUSES)(v)),
  notes: str(2000),
};
const TRANSACTION = {
  type: oneOf('entrada', 'saida'),
  description: required(str(200)),
  category: required(str(60)),
  amount: (v) => {
    const n = num()(v);
    if (!(n > 0)) throw new HttpError(400, 'Informe um valor maior que zero.');
    return n;
  },
  date: date,
  is_paid: bool,
};

// ---------- Consultas compartilhadas ----------
const APPT_SELECT = `
  select a.*,
         json_build_object('id', c.id, 'name', c.name, 'phone', c.phone) as clients,
         case when s.id is null then null else json_build_object('name', s.name) end as services
  from appointments a
  join clients c on c.id = a.client_id
  left join services s on s.id = a.service_id`;

async function assertNoConflict(userId, startsAt, durationMin, ignoreId) {
  const end = new Date(new Date(startsAt).getTime() + durationMin * 60000).toISOString();
  const other = await one(
    `select a.starts_at, c.name from appointments a join clients c on c.id = a.client_id
     where a.user_id = $1 and a.status in ('agendado','concluido')
       and a.starts_at < $3 and a.ends_at > $2 and ($4::uuid is null or a.id <> $4::uuid)
     order by a.starts_at limit 1`,
    [userId, startsAt, end, ignoreId ?? null]);
  if (other) {
    const hour = new Date(other.starts_at).toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    });
    throw new HttpError(409, `Conflito: já existe horário às ${hour} com ${other.name}.`);
  }
}

// ---------- Rotas ----------
// Cada rota: [método, caminho, handler, { public: true } opcional]
export const routes = [
  ['GET', '/api/health', async () => { await query('select 1'); return { ok: true }; }, { public: true }],

  // Autenticação
  ['POST', '/api/login', async ({ req, res, body }) => {
    const key = req.socket.remoteAddress + '|' + String(body.email).toLowerCase();
    if (tooManyAttempts(key)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
    const user = await one('select * from users where email = $1', [String(body.email || '').trim().toLowerCase()]);
    if (!user || !(await verifyPassword(String(body.password || ''), user.password_hash))) {
      recordFailure(key);
      throw new HttpError(401, 'E-mail ou senha incorretos.');
    }
    setSessionCookie(req, res, user);
    return { id: user.id, email: user.email };
  }, { public: true }],

  ['POST', '/api/logout', async ({ req, res }) => { clearSessionCookie(req, res); return { ok: true }; }, { public: true }],

  ['GET', '/api/me', async ({ user }) => ({ id: user.id, email: user.email })],

  ['POST', '/api/password', async ({ req, res, user, body }) => {
    const password = String(body.password || '');
    if (password.length < 8) throw new HttpError(400, 'A senha precisa ter pelo menos 8 caracteres.');
    const updated = await one(
      'update users set password_hash = $2, session_version = session_version + 1 where id = $1 returning *',
      [user.id, await hashPassword(password)]);
    setSessionCookie(req, res, updated); // outras sessões são encerradas
    return { ok: true };
  }],

  // Configurações
  ['GET', '/api/settings', async ({ user }) => {
    await query('insert into settings (user_id) values ($1) on conflict (user_id) do nothing returning user_id', [user.id]);
    return one('select * from settings where user_id = $1', [user.id]);
  }],
  ['PUT', '/api/settings', async ({ user, body }) => {
    const row = pick(body, { business_name: required(str(80)), return_message: required(str(1000)) });
    return one(
      `insert into settings (user_id, business_name, return_message) values ($1, $2, $3)
       on conflict (user_id) do update set business_name = excluded.business_name, return_message = excluded.return_message
       returning *`,
      [user.id, row.business_name, row.return_message]);
  }],

  // Serviços
  ['GET', '/api/services', ({ user }) => query('select * from services where user_id = $1 order by name', [user.id])],
  ['POST', '/api/services', async ({ user, body }) => {
    const items = Array.isArray(body) ? body : [body];
    if (items.length > 50) throw new HttpError(400, 'Muitos itens.');
    const saved = [];
    for (const item of items) {
      const { text, values } = insertSql('services', pick({ active: true, price: 0, ...item }, SERVICE), user.id);
      saved.push(await one(text, values));
    }
    return Array.isArray(body) ? saved : saved[0];
  }],
  ['PUT', '/api/services/:id', async ({ user, params, body }) => {
    const { text, values } = updateSql('services', pick(body, SERVICE), uuid(params.id), user.id);
    return found(await one(text, values));
  }],
  ['DELETE', '/api/services/:id', async ({ user, params }) => {
    found(await one('delete from services where id = $1 and user_id = $2 returning id', [uuid(params.id), user.id]));
    return { ok: true };
  }],

  // Clientes
  ['GET', '/api/clients', ({ user }) =>
    query('select id, name, phone from clients where user_id = $1 order by lower(name)', [user.id])],
  ['GET', '/api/clients/:id', async ({ user, params }) =>
    found(await one('select * from clients where id = $1 and user_id = $2', [uuid(params.id), user.id]))],
  ['POST', '/api/clients', async ({ user, body }) => {
    const { text, values } = insertSql('clients', pick(body, CLIENT), user.id);
    return one(text, values);
  }],
  ['PUT', '/api/clients/:id', async ({ user, params, body }) => {
    const { text, values } = updateSql('clients', pick(body, CLIENT), uuid(params.id), user.id);
    return found(await one(text, values));
  }],
  ['DELETE', '/api/clients/:id', async ({ user, params }) => {
    found(await one('delete from clients where id = $1 and user_id = $2 returning id', [uuid(params.id), user.id]));
    return { ok: true };
  }],

  // Agendamentos
  ['GET', '/api/appointments', ({ user, url }) => {
    const p = url.searchParams;
    const where = ['a.user_id = $1'];
    const values = [user.id];
    if (p.get('from')) { values.push(timestamp(p.get('from'))); where.push(`a.starts_at >= $${values.length}`); }
    if (p.get('to')) { values.push(timestamp(p.get('to'))); where.push(`a.starts_at < $${values.length}`); }
    if (p.get('client_id')) { values.push(uuid(p.get('client_id'))); where.push(`a.client_id = $${values.length}`); }
    if (p.get('exclude_cancelled') === '1') where.push(`a.status <> 'cancelado'`);
    const order = p.get('order') === 'desc' ? 'desc' : 'asc';
    return query(`${APPT_SELECT} where ${where.join(' and ')} order by a.starts_at ${order}`, values);
  }],

  ['POST', '/api/appointments', async ({ user, body }) => {
    const row = pick(body, APPOINTMENT);
    if (row.status === 'agendado' || row.status === 'concluido') {
      await assertNoConflict(user.id, row.starts_at, row.duration_min);
    }
    const { text, values } = insertSql('appointments', { ...row, ends_at: row.starts_at }, user.id);
    return one(text, values);
  }],

  ['PUT', '/api/appointments/:id', async ({ user, params, body }) => {
    const id = uuid(params.id);
    const row = pick(body, APPOINTMENT);
    if (row.status === 'agendado' || row.status === 'concluido') {
      await assertNoConflict(user.id, row.starts_at, row.duration_min, id);
    }
    const cols = Object.keys(row);
    // Mantém o caixa coerente: sai de "concluído" -> remove a entrada; continua concluído -> atualiza o valor
    return found(await one(
      `with a as (
         update appointments set ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}
         where id = $1 and user_id = $2 returning *
       ), d as (
         delete from transactions t using a
         where t.appointment_id = a.id and a.status <> 'concluido' returning t.id
       ), u as (
         update transactions t set amount = a.price from a
         where t.appointment_id = a.id and a.status = 'concluido' and a.price > 0 returning t.id
       )
       select * from a`,
      [id, user.id, ...Object.values(row)]));
  }],

  ['POST', '/api/appointments/:id/complete', async ({ user, params, body }) => {
    const id = uuid(params.id);
    const price = num()(body.price);
    if (price == null) throw new HttpError(400, 'Valor inválido.');
    const current = found(await one(
      `select a.*, c.name as client_name, s.name as service_name
       from appointments a join clients c on c.id = a.client_id left join services s on s.id = a.service_id
       where a.id = $1 and a.user_id = $2`, [id, user.id]));
    if (current.status !== 'concluido') await assertNoConflict(user.id, current.starts_at, current.duration_min, id);
    const description = [current.service_name, current.client_name].filter(Boolean).join(' - ') || 'Atendimento';
    return one(
      `with a as (
         update appointments set status = 'concluido', price = $3
         where id = $1 and user_id = $2 returning *
       ), t as (
         insert into transactions (user_id, appointment_id, type, category, description, amount, date, is_paid)
         select a.user_id, a.id, 'entrada', 'Atendimento', $4, a.price,
                (a.starts_at at time zone 'America/Sao_Paulo')::date, $5
         from a where a.price > 0
         on conflict (appointment_id) do update
           set amount = excluded.amount, is_paid = excluded.is_paid, description = excluded.description
         returning id
       )
       select * from a`,
      [id, user.id, price, description, bool(body.paid)]);
  }],

  ['POST', '/api/appointments/:id/status', async ({ user, params, body }) => {
    const id = uuid(params.id);
    const status = oneOf('agendado', 'cancelado', 'faltou')(body.status);
    const current = found(await one('select * from appointments where id = $1 and user_id = $2', [id, user.id]));
    if (status === 'agendado') await assertNoConflict(user.id, current.starts_at, current.duration_min, id);
    return one(
      `with a as (
         update appointments set status = $3 where id = $1 and user_id = $2 returning *
       ), d as (
         delete from transactions t using a where t.appointment_id = a.id returning t.id
       )
       select * from a`,
      [id, user.id, status]);
  }],

  ['POST', '/api/appointments/:id/reminded', async ({ user, params }) =>
    found(await one('update appointments set return_reminded_at = now() where id = $1 and user_id = $2 returning id',
      [uuid(params.id), user.id]))],

  ['DELETE', '/api/appointments/:id', async ({ user, params }) => {
    found(await one('delete from appointments where id = $1 and user_id = $2 returning id', [uuid(params.id), user.id]));
    return { ok: true };
  }],

  // Retornos: último atendimento concluído de cada cliente e se ela já reagendou
  ['GET', '/api/returns', ({ user }) => query(
    `select * from (
       select distinct on (a.client_id)
         a.client_id, c.name as client_name, c.phone, a.id as appointment_id,
         a.starts_at as last_visit, s.name as service_name, a.return_due, a.return_reminded_at,
         exists (
           select 1 from appointments f
           where f.client_id = a.client_id and f.status = 'agendado' and f.starts_at > a.starts_at
         ) as has_next_appointment
       from appointments a
       join clients c on c.id = a.client_id
       left join services s on s.id = a.service_id
       where a.user_id = $1 and a.status = 'concluido'
       order by a.client_id, a.starts_at desc
     ) r
     where r.return_due is not null
     order by r.return_due`,
    [user.id])],

  // Caixa
  ['GET', '/api/transactions', ({ user, url }) => {
    const from = date(url.searchParams.get('from'));
    const to = date(url.searchParams.get('to'));
    return query(
      `select * from transactions where user_id = $1 and date between $2 and $3
       order by date desc, created_at desc`, [user.id, from, to]);
  }],
  ['POST', '/api/transactions', async ({ user, body }) => {
    const { text, values } = insertSql('transactions', pick(body, TRANSACTION), user.id);
    return one(text, values);
  }],
  ['PUT', '/api/transactions/:id', async ({ user, params, body }) => {
    const { text, values } = updateSql('transactions', pick(body, TRANSACTION, { partial: true }), uuid(params.id), user.id);
    return found(await one(text, values));
  }],
  ['DELETE', '/api/transactions/:id', async ({ user, params }) => {
    found(await one('delete from transactions where id = $1 and user_id = $2 returning id', [uuid(params.id), user.id]));
    return { ok: true };
  }],
];
