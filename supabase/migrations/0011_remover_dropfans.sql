-- Limpeza: remove tudo que sobrou da integração antiga (Dropfans).
-- Seguro em banco novo (nada a remover) e em banco que já tinha as migrations antigas.
drop trigger if exists orders_sync_dropfans_payment on public.orders;
drop function if exists public.sync_dropfans_order_status();
drop function if exists public.apply_dropfans_payment(text, integer, text, text, text);
drop function if exists public.apply_dropfans_payment(text, text, integer, text, text, text, text, text, text);
drop table if exists public.dropfans_payments;

drop index if exists public.items_dropfans_product_id_idx;
alter table public.items drop constraint if exists items_dropfans_amount_cents_check;
alter table public.items
  drop column if exists dropfans_product_id,
  drop column if exists dropfans_amount_cents;

update public.payments set method = 'pix' where method = 'dropfans';
