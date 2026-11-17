-- GOLDREX · 0003 · Armazenamento de fotos e vídeos (Supabase Storage)
--   previews  : PRIVADO  - miniaturas borradas, capas, avatares e teasers borrados
--   originals : PRIVADO  - fotos/vídeos originais em qualidade integral; só o servidor lê,
--                          e entrega ao cliente depois que o pagamento é confirmado ou a liberação é manual.
-- Limite por arquivo: o plano gratuito do Supabase aceita até 50 MB por arquivo (ajuste se o seu plano permitir mais).

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('previews',  'previews',  false, 52428800),
  ('originals', 'originals', false, 52428800)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit;

-- Nenhuma política é criada em storage.objects: sem política, os buckets privados não podem ser
-- lidos nem escritos pelas chaves "anon"/"authenticated". O servidor usa service_role.
