-- Dados da cobrança do provedor. CPF/nome do pagador não são persistidos no GOLDREX.
alter table public.payments
  add column if not exists provider text not null default 'manual'
    check (provider in ('manual', 'asaas')),
  add column if not exists provider_payment_id text,
  add column if not exists pix_copy_paste text,
  add column if not exists pix_encoded_image text;

create unique index if not exists payments_provider_payment_id_idx
  on public.payments(provider_payment_id)
  where provider_payment_id is not null;
