// Wendao backend · centralized config · everything via env vars with sensible local defaults
// (defaults assume a local Ollama on :11434 and ffmpeg/ffprobe on PATH).
import { resolve } from 'node:path'

export const config = {
  port: Number(process.env.PORT ?? 3100),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN?.split(',') ?? true,

  /** 媒体/转码产物本地存储根目录 */
  storageDir: resolve(process.env.MIAOJI_STORAGE_DIR ?? './.storage'),

  /** Optional archive root (empty = no archiving). When set, a READY minute's
   *  original recording + transcript copy are filed under
   *  <archiveDir>/<YYYY-MM>/<title-token>/. Point it at any local dir or a
   *  mounted NAS/SMB share, e.g. /mnt/archive or D:\\archive\\wendao. */
  archiveDir: process.env.MIAOJI_ARCHIVE_DIR ?? '',

  /** ffmpeg / ffprobe 可执行名(在 PATH 中) */
  ffmpeg: process.env.FFMPEG_BIN ?? 'ffmpeg',
  ffprobe: process.env.FFPROBE_BIN ?? 'ffprobe',

  /** Python ASR/diarization 微服务 */
  asrBaseUrl: process.env.MIAOJI_ASR_URL ?? 'http://127.0.0.1:9400',

  /** Ollama OpenAI-compatible endpoint */
  llm: {
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1',
    apiKey: process.env.OLLAMA_API_KEY ?? 'ollama',
    model: process.env.MIAOJI_LLM_MODEL ?? 'qwen3:30b-a3b'
  }
} as const
