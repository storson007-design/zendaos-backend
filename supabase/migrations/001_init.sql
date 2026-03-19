-- ============================================================
-- ZendaOS — Initial Schema
-- ============================================================

-- Usuarios del sistema (solopreneurs)
create table users (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  business_name text,
  service_type text,                    -- fisioterapia | tatuajes | coaching | belleza | otro
  work_start time default '09:00',
  work_end time default '18:00',
  agenda_slug text unique,              -- juan → zendaos.com/agenda/juan
  onboarding_step int default 0,        -- 0=nuevo, 3=completo
  stripe_customer_id text,
  subscription_status text default 'trial',  -- trial | active | cancelled
  created_at timestamptz default now()
);

-- Clientes de cada usuario
create table clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  notes text,
  total_spent numeric default 0,
  created_at timestamptz default now()
);

-- Citas
create table appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  client_id uuid references clients(id),
  client_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text default 'scheduled',      -- scheduled | confirmed | cancelled | completed
  notes text,
  created_at timestamptz default now()
);

-- Pagos registrados
create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  client_id uuid references clients(id),
  client_name text not null,
  amount numeric not null,
  description text,
  paid_at timestamptz default now()
);

-- Presupuestos
create table quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  client_id uuid references clients(id),
  client_name text not null,
  service text not null,
  amount numeric not null,
  status text default 'draft',          -- draft | sent | accepted | rejected
  created_at timestamptz default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table users        enable row level security;
alter table clients      enable row level security;
alter table appointments enable row level security;
alter table payments     enable row level security;
alter table quotes       enable row level security;

-- users: cada registro es el propio usuario (id = auth.uid())
create policy "users: own row" on users
  for all using (id = auth.uid());

-- clients: solo accede el dueño
create policy "clients: owner only" on clients
  for all using (user_id = auth.uid());

-- appointments: solo accede el dueño
create policy "appointments: owner only" on appointments
  for all using (user_id = auth.uid());

-- payments: solo accede el dueño
create policy "payments: owner only" on payments
  for all using (user_id = auth.uid());

-- quotes: solo accede el dueño
create policy "quotes: owner only" on quotes
  for all using (user_id = auth.uid());
