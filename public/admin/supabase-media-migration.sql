-- =====================================================================
-- MIGRAÇÃO: Suporte a mídias (imagens, vídeos, áudios, documentos)
-- ---------------------------------------------------------------------
-- Rode UMA VEZ no SQL Editor do Supabase. É idempotente (IF NOT EXISTS).
--
-- O que faz:
--   1. Adiciona colunas de mídia na tabela messages
--   2. Cria o bucket 'whatsapp-media' no Supabase Storage (público)
--   3. Cria políticas RLS para leitura pública e inserção anon
-- =====================================================================

-- 1. Colunas de mídia na tabela messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type     TEXT;  -- image|video|audio|document|sticker
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url      TEXT;  -- URL pública no Supabase Storage
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_mime     TEXT;  -- MIME type original
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_filename TEXT;  -- nome do arquivo (documentos)

-- 2. Bucket de armazenamento (público — as URLs são permalinks na CDN do Supabase)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'whatsapp-media',
  'whatsapp-media',
  true,
  52428800,   -- 50 MB por arquivo
  null        -- aceita qualquer MIME
)
ON CONFLICT (id) DO NOTHING;

-- 3. Políticas RLS do bucket
--    O projeto usa anon key com allow_all — mesmo padrão aqui.
DO $$
BEGIN
  -- Leitura pública (qualquer um pode ver as mídias via URL)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'whatsapp-media public read'
  ) THEN
    CREATE POLICY "whatsapp-media public read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'whatsapp-media');
  END IF;

  -- Inserção pelo anon key (webhook e frontend do CRM)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'whatsapp-media anon insert'
  ) THEN
    CREATE POLICY "whatsapp-media anon insert"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'whatsapp-media');
  END IF;

  -- Deleção pelo anon key (limpeza futura)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND schemaname = 'storage'
      AND policyname = 'whatsapp-media anon delete'
  ) THEN
    CREATE POLICY "whatsapp-media anon delete"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'whatsapp-media');
  END IF;
END $$;

-- Conferir:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'messages' AND column_name LIKE 'media%';
--
-- SELECT * FROM storage.buckets WHERE id = 'whatsapp-media';
