-- GOLDREX · 0007 · Previews privados
-- Não altera nem remove arquivos existentes. O servidor os entrega após a confirmação 18+.
update storage.buckets
   set public = false
 where id = 'previews';
