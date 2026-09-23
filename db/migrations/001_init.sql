create sequence allsquare.sync_seq;

create function allsquare.bump_seq() returns trigger
language plpgsql
set search_path = allsquare
as $$
begin
  new.seq := nextval('allsquare.sync_seq');
  return new;
end
$$;

create table allsquare.users (
  id          uuid primary key default gen_random_uuid(),
  google_sub  text unique not null,
  email       text not null,
  name        text,
  upi_vpa     text,
  created_at  timestamptz not null default now()
);

create table allsquare.members (
  id          uuid primary key,
  user_id     uuid not null references allsquare.users(id),
  name        text not null,
  kind        text not null default 'person' check (kind in ('person','family')),
  phone       text,
  family_id   uuid,
  weight      numeric(4,2) not null default 1,
  is_self     boolean not null default false,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  seq         bigint not null,
  unique (user_id, id)
);
create unique index one_self_per_user on allsquare.members(user_id) where is_self;
alter table allsquare.members
  add foreign key (user_id, family_id) references allsquare.members(user_id, id);

create table allsquare.groups (
  id            uuid primary key,
  user_id       uuid not null references allsquare.users(id),
  name          text not null,
  kind          text,
  default_split text not null default 'per_head' check (default_split in ('per_head','per_party')),
  currency      text not null default 'INR',
  starts_on     date,
  ends_on       date,
  archived      boolean not null default false,
  updated_at    timestamptz not null,
  deleted_at    timestamptz,
  seq           bigint not null,
  unique (user_id, id)
);

create table allsquare.group_members (
  user_id     uuid not null,
  group_id    uuid not null,
  member_id   uuid not null,
  weight      numeric(5,2) check (weight > 0),
  sort_order  int not null default 0,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  seq         bigint not null,
  primary key (group_id, member_id),
  foreign key (user_id, group_id)  references allsquare.groups(user_id, id),
  foreign key (user_id, member_id) references allsquare.members(user_id, id)
);

create table allsquare.expenses (
  id           uuid primary key,
  user_id      uuid not null,
  group_id     uuid not null,
  paid_by      uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  split_type   text not null check (split_type in ('per_head','per_party','shares','exact')),
  note         text,
  category     text,
  spent_on     date not null,
  created_at   timestamptz not null,
  updated_at   timestamptz not null,
  deleted_at   timestamptz,
  seq          bigint not null,
  unique (user_id, id),
  foreign key (user_id, group_id) references allsquare.groups(user_id, id),
  foreign key (user_id, paid_by)  references allsquare.members(user_id, id)
);

create table allsquare.expense_splits (
  user_id     uuid not null,
  expense_id  uuid not null,
  member_id   uuid not null,
  weight      numeric(8,2),
  people      uuid[],
  owed_paise  bigint not null check (owed_paise >= 0),
  primary key (expense_id, member_id),
  foreign key (user_id, expense_id) references allsquare.expenses(user_id, id) on delete cascade,
  foreign key (user_id, member_id)  references allsquare.members(user_id, id)
);

create table allsquare.settlements (
  id           uuid primary key,
  user_id      uuid not null,
  group_id     uuid not null,
  from_member  uuid not null,
  to_member    uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  note         text,
  paid_on      date not null,
  updated_at   timestamptz not null,
  deleted_at   timestamptz,
  seq          bigint not null,
  check (from_member <> to_member),
  foreign key (user_id, group_id)    references allsquare.groups(user_id, id),
  foreign key (user_id, from_member) references allsquare.members(user_id, id),
  foreign key (user_id, to_member)   references allsquare.members(user_id, id)
);

create table allsquare.share_links (
  id          uuid primary key,
  user_id     uuid not null references allsquare.users(id),
  token       text unique not null,
  group_id    uuid,
  member_id   uuid,
  updated_at  timestamptz not null,
  revoked_at  timestamptz,
  seq         bigint not null,
  check (group_id is not null or member_id is not null),
  foreign key (user_id, group_id)  references allsquare.groups(user_id, id),
  foreign key (user_id, member_id) references allsquare.members(user_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['members','groups','group_members','expenses','settlements','share_links']
  loop
    execute format(
      'create trigger %I before insert or update on allsquare.%I for each row execute function allsquare.bump_seq()',
      t || '_seq',
      t
    );
    execute format('create index on allsquare.%I (user_id, seq)', t);
  end loop;
end
$$;

create index on allsquare.expenses (group_id) where deleted_at is null;
create index on allsquare.settlements (group_id) where deleted_at is null;
