-- =====================================================================
-- Maiza Manicure - estrutura do banco de dados (Supabase / PostgreSQL)
-- Como usar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Pode ser executado mais de uma vez sem perder dados.
-- =====================================================================

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- Serviços (com prazo de retorno configurável)
-- ---------------------------------------------------------------------
create table if not exists public.services (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  duration_min  integer not null default 60 check (duration_min > 0),
  price         numeric(10,2) not null default 0 check (price >= 0),
  return_days   integer check (return_days is null or return_days > 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name              text not null check (length(trim(name)) > 0),
  phone             text,
  notes             text,
  -- autorização da cliente para receber lembretes automáticos (fase do WhatsApp automático)
  whatsapp_opt_in   boolean not null default false,
  created_at        timestamptz not null default now()
);
create index if not exists clients_user_name_idx on public.clients (user_id, name);

-- ---------------------------------------------------------------------
-- Agendamentos
-- ---------------------------------------------------------------------
create table if not exists public.appointments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id           uuid not null references public.clients(id) on delete cascade,
  service_id          uuid references public.services(id) on delete set null,
  starts_at           timestamptz not null,
  duration_min        integer not null default 60 check (duration_min > 0),
  ends_at             timestamptz not null,
  price               numeric(10,2) not null default 0 check (price >= 0),
  status              text not null default 'agendado'
                      check (status in ('agendado','concluido','cancelado','faltou')),
  notes               text,
  return_due          date,          -- data prevista de retorno (calculada ao concluir)
  return_reminded_at  timestamptz,   -- quando o lembrete de retorno foi enviado
  created_at          timestamptz not null default now()
);
create index if not exists appointments_user_start_idx on public.appointments (user_id, starts_at);
create index if not exists appointments_client_idx on public.appointments (client_id, starts_at desc);

-- Impede dois horários sobrepostos (cancelados e faltas não bloqueiam a agenda)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_no_overlap') then
    alter table public.appointments
      add constraint appointments_no_overlap
      exclude using gist (
        user_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      ) where (status in ('agendado','concluido'));
  end if;
end $$;

-- Calcula fim do horário e data de retorno automaticamente
create or replace function public.appointments_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_return_days integer;
begin
  new.ends_at := new.starts_at + make_interval(mins => new.duration_min);

  if new.status = 'concluido' then
    if tg_op = 'INSERT'
       or old.status is distinct from 'concluido'
       or old.service_id is distinct from new.service_id
       or old.starts_at is distinct from new.starts_at then
      select return_days into v_return_days from public.services where id = new.service_id;
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

drop trigger if exists appointments_before_write on public.appointments;
create trigger appointments_before_write
  before insert or update on public.appointments
  for each row execute function public.appointments_before_write();

-- ---------------------------------------------------------------------
-- Caixa (entradas e saídas)
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type            text not null check (type in ('entrada','saida')),
  description     text not null check (length(trim(description)) > 0),
  category        text not null default 'Outros',
  amount          numeric(10,2) not null check (amount > 0),
  date            date not null default (now() at time zone 'America/Sao_Paulo')::date,
  -- false = ainda não recebido/pago (não entra no saldo)
  is_paid         boolean not null default true,
  -- liga a entrada ao atendimento, evitando lançamento duplicado
  appointment_id  uuid unique references public.appointments(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, date);

-- ---------------------------------------------------------------------
-- Configurações da conta
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  user_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  business_name   text not null default 'Meu Studio',
  return_message  text not null default
    'Oi {nome}! Tudo bem? 💅 Já está chegando a hora de refazer sua {servico}. Quer que eu reserve um horário pra você?'
);

-- ---------------------------------------------------------------------
-- Visão de retornos: último atendimento concluído de cada cliente
-- e se ela já tem um novo horário marcado
-- ---------------------------------------------------------------------
create or replace view public.client_returns
with (security_invoker = true) as
select distinct on (a.client_id)
  a.client_id,
  c.name            as client_name,
  c.phone,
  a.id              as appointment_id,
  a.starts_at       as last_visit,
  s.name            as service_name,
  a.return_due,
  a.return_reminded_at,
  exists (
    select 1 from public.appointments f
    where f.client_id = a.client_id
      and f.status = 'agendado'
      and f.starts_at > a.starts_at
  ) as has_next_appointment
from public.appointments a
join public.clients c on c.id = a.client_id
left join public.services s on s.id = a.service_id
where a.status = 'concluido'
order by a.client_id, a.starts_at desc;

-- ---------------------------------------------------------------------
-- Segurança: cada conta só enxerga e altera os próprios dados
-- ---------------------------------------------------------------------
alter table public.services     enable row level security;
alter table public.clients      enable row level security;
alter table public.appointments enable row level security;
alter table public.transactions enable row level security;
alter table public.settings     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['services','clients','appointments','transactions','settings'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Garante que um agendamento só aponte para cliente/serviço da mesma conta
create or replace function public.appointments_check_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from public.clients where id = new.client_id and user_id = new.user_id) then
    raise exception 'Cliente inválida';
  end if;
  if new.service_id is not null
     and not exists (select 1 from public.services where id = new.service_id and user_id = new.user_id) then
    raise exception 'Serviço inválido';
  end if;
  return new;
end $$;

drop trigger if exists appointments_check_owner on public.appointments;
create trigger appointments_check_owner
  before insert or update on public.appointments
  for each row execute function public.appointments_check_owner();
