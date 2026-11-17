-- Bio opcional do card/pack de fotos e vídeos (rode no SQL Editor do Supabase)
alter table public.items add column if not exists bio text not null default '';
