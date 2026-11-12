-- Estrutura do banco (PostgreSQL). Executada automaticamente quando o servidor inicia.
-- Pode rodar várias vezes sem perder dados.

create extension if not exists btree_gist;

create table if not exists users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,
  password_hash    text not null,
  session_version  integer not null default 1,
  created_at       timestamptz not null default now()
);

create table if not exists services (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  duration_min  integer not null default 60 check (duration_min > 0),
  price         numeric(10,2) not null default 0 check (price >= 0),
  return_days   integer check (return_days is null or return_days > 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists services_user_idx on services (user_id, name);

create table if not exists clients (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  name              text not null check (length(trim(name)) > 0),
  phone             text,
  notes             text,
  whatsapp_opt_in   boolean not null default false,  -- autorização para lembretes automáticos
  created_at        timestamptz not null default now()
);
create index if not exists clients_user_name_idx on clients (user_id, name);

create table if not exists appointments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  client_id           uuid not null references clients(id) on delete cascade,
  service_id          uuid references services(id) on delete set null,
  starts_at           timestamptz not null,
  duration_min        integer not null default 60 check (duration_min > 0),
  ends_at             timestamptz not null,
  price               numeric(10,2) not null default 0 check (price >= 0),
  status              text not null default 'agendado'
                      check (status in ('agendado','concluido','cancelado','faltou')),
  notes               text,
  return_due          date,          -- data prevista de retorno (calculada ao concluir)
  return_reminded_at  timestamptz,   -- quando a cliente foi avisada do retorno
  created_at          timestamptz not null default now()
);
create index if not exists appointments_user_start_idx on appointments (user_id, starts_at);
create index if not exists appointments_client_idx on appointments (client_id, starts_at desc);

-- Impede horários sobrepostos (cancelados e faltas não bloqueiam a agenda)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_no_overlap') then
    alter table appointments
      add constraint appointments_no_overlap
      exclude using gist (
        user_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      ) where (status in ('agendado','concluido'));
  end if;
end $$;

-- Calcula o fim do horário e a data de retorno; confere se cliente e serviço são da mesma conta
create or replace function appointments_before_write()
returns trigger
language plpgsql
as $$
declare
  v_return_days integer;
begin
  if not exists (select 1 from clients where id = new.client_id and user_id = new.user_id) then
    raise exception 'Cliente inválida' using errcode = 'P0001';
  end if;
  if new.service_id is not null
     and not exists (select 1 from services where id = new.service_id and user_id = new.user_id) then
    raise exception 'Serviço inválido' using errcode = 'P0001';
  end if;

  new.ends_at := new.starts_at + make_interval(mins => new.duration_min);

  if new.status = 'concluido' then
    if tg_op = 'INSERT'
       or old.status is distinct from 'concluido'
       or old.service_id is distinct from new.service_id
       or old.starts_at is distinct from new.starts_at then
      select return_days into v_return_days from services where id = new.service_id;
      if v_return_days is not null then
        new.return_due := (new.starts_at at time zone 'America/Sao_Paulo')::date + v_return_days;
        new.return_reminded_at := null;
      else
        new.return_due := null;
      end if;
    end if;
  else
    new.return_due := null;
  end if;

  return new;
end $$;

drop trigger if exists appointments_before_write on appointments;
create trigger appointments_before_write
  before insert or update on appointments
  for each row execute function appointments_before_write();

create table if not exists transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  type            text not null check (type in ('entrada','saida')),
  description     text not null check (length(trim(description)) > 0),
  category        text not null default 'Outros',
  amount          numeric(10,2) not null check (amount > 0),
  date            date not null default (now() at time zone 'America/Sao_Paulo')::date,
  is_paid         boolean not null default true,      -- false = ainda não recebido/pago (fora do saldo)
  appointment_id  uuid unique references appointments(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on transactions (user_id, date);

create table if not exists settings (
  user_id         uuid primary key references users(id) on delete cascade,
  business_name   text not null default 'Meu Studio',
  return_message  text not null default
    'Oi {nome}! Tudo bem? 💅 Já está chegando a hora de refazer sua {servico}. Quer que eu reserve um horário pra você?'
);
