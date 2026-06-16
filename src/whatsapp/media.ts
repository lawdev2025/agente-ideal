import axios from "axios";
import { getSupabase } from "../db/supabase-client";
import { logger } from "../logger";
import { config } from "../config";

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

function mimeExt(mime: string): string {
  return MIME_EXT[mime.split(';')[0].trim()] ?? 'bin';
}

export async function downloadWaMediaToStorage(
  mediaId: string,
  mimeType: string
): Promise<string | null> {
  const token = config.whatsapp.accessToken;
  try {
    const { data: meta } = await axios.get(
      `https://graph.facebook.com/v22.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const { data: fileData } = await axios.get(meta.url, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${token}` },
    });
    const buffer = Buffer.from(fileData);
    const sb = getSupabase();
    const path = `${Date.now()}-${mediaId.slice(-8)}.${mimeExt(mimeType)}`;
    const { error } = await sb.storage
      .from('whatsapp-media')
      .upload(path, buffer, { contentType: mimeType.split(';')[0].trim(), upsert: false });
    if (error) {
      logger.error({ error, mediaId }, 'Upload de mídia pro Storage falhou');
      return null;
    }
    const { data: { publicUrl } } = sb.storage.from('whatsapp-media').getPublicUrl(path);
    return publicUrl;
  } catch (e) {
    logger.error({ e, mediaId }, 'Erro ao baixar/armazenar mídia WA');
    return null;
  }
}
