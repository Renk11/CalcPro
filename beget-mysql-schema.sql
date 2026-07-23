create table if not exists app_settings (
  `key` varchar(255) not null,
  `value` longtext not null,
  created_at datetime not null default current_timestamp,
  updated_at datetime not null default current_timestamp on update current_timestamp,
  primary key (`key`)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists payments (
  id varchar(191) not null,
  status varchar(64) not null default 'pending',
  amount_rub decimal(12,2) not null default 0,
  description text null,
  payment_url text null,
  paid_at datetime null,
  created_at datetime not null default current_timestamp,
  updated_at datetime not null default current_timestamp on update current_timestamp,
  primary key (id),
  key idx_payments_status (status)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
