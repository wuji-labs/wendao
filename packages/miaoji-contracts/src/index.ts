// 妙记 (Feishu Minutes 复刻) · 共享 Zod schema · 前后端 + ASR 服务类型唯一源头
// 任何新增 schema 都从这里 export。前端、后端、Python ASR 服务三方对齐此契约。

import { z } from 'zod'

/* ────────────────────────────── 枚举 ────────────────────────────── */

/** 妙记来源 · 对齐飞书四种生成路径 */
export const MinuteSource = z.enum(['MEETING', 'UPLOAD', 'CLOUD', 'MOBILE_RECORD'])
export type MinuteSource = z.infer<typeof MinuteSource>

export const MediaType = z.enum(['AUDIO', 'VIDEO'])
export type MediaType = z.infer<typeof MediaType>

/** 妙记处理状态机 · upload→transcode→transcribe→ready(失败=FAILED) */
export const MinuteStatus = z.enum([
  'UPLOADING',
  'TRANSCODING',
  'TRANSCRIBING',
  'DIARIZING',
  'SEGMENTING',
  'SUMMARIZING',
  'READY',
  'FAILED'
])
export type MinuteStatus = z.infer<typeof MinuteStatus>

/** 处理流水线阶段 · 每阶段一条 job 记录 */
export const JobStage = z.enum(['TRANSCODE', 'ASR', 'DIARIZE', 'SEGMENT', 'SUMMARIZE', 'INDEX'])
export type JobStage = z.infer<typeof JobStage>

export const JobStatus = z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED'])
export type JobStatus = z.infer<typeof JobStatus>

/** 支持语言 · 对齐飞书(普通话/英语/日语) */
export const Lang = z.enum(['zh', 'en', 'ja'])
export type Lang = z.infer<typeof Lang>

export const TodoStatus = z.enum(['OPEN', 'DONE', 'CANCELLED'])
export type TodoStatus = z.infer<typeof TodoStatus>

/** 权限主体类型 */
export const SubjectType = z.enum(['MINUTE', 'FOLDER', 'CLIP'])
export type SubjectType = z.infer<typeof SubjectType>

/** 协作角色 · 由低到高 */
export const CollaboratorRole = z.enum(['VIEWER', 'COMMENTER', 'EDITOR', 'MANAGER'])
export type CollaboratorRole = z.infer<typeof CollaboratorRole>

/** 链接分享范围 */
export const LinkScope = z.enum(['CLOSED', 'TENANT_VIEW', 'TENANT_EDIT', 'ANYONE_VIEW'])
export type LinkScope = z.infer<typeof LinkScope>

export const QaRole = z.enum(['user', 'assistant'])
export type QaRole = z.infer<typeof QaRole>

/* ─────────────────────────── 基础工具 schema ─────────────────────────── */

const id = z.string().uuid()
const ms = z.number().int().nonnegative()
const isoDate = z.union([z.string(), z.date()])

/** 词级时间戳 · karaoke 同步高亮 + 点词定位的基础 */
export const Word = z.object({
  w: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  score: z.number().min(0).max(1).optional()
})
export type Word = z.infer<typeof Word>

/* ────────────────────────────── 用户 ────────────────────────────── */

export const User = z.object({
  id,
  name: z.string().min(1).max(64),
  email: z.string().email().nullable(),
  avatarUrl: z.string().url().nullable(),
  createdAt: isoDate
})
export type User = z.infer<typeof User>

/* ────────────────────────────── 文件夹 ────────────────────────────── */

export const Folder = z.object({
  id,
  name: z.string().min(1).max(128),
  ownerId: id,
  parentId: id.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate
})
export type Folder = z.infer<typeof Folder>

/* ────────────────────────────── 妙记 ────────────────────────────── */

export const Minute = z.object({
  id,
  /** 短 token · 对齐飞书 url token 习惯 */
  token: z.string().min(8).max(32),
  ownerId: id,
  folderId: id.nullable(),
  title: z.string().max(256),
  cover: z.string().nullable(),
  source: MinuteSource,
  mediaType: MediaType,
  /** 原始媒体存储 key(对象存储/本地) */
  mediaKey: z.string().nullable(),
  /** 转码后可直接播放的 mp4/m4a key */
  playableKey: z.string().nullable(),
  durationMs: ms,
  language: Lang,
  status: MinuteStatus,
  /** 错误信息 · status=FAILED 时填 */
  errorMessage: z.string().nullable(),
  visitorCount: z.number().int().nonnegative(),
  visitCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  /** 消耗的转写额度(分钟) */
  quotaMinutes: z.number().int().nonnegative(),
  linkScope: LinkScope,
  createdAt: isoDate,
  updatedAt: isoDate
})
export type Minute = z.infer<typeof Minute>

/* ────────────────────────────── 说话人 ────────────────────────────── */

export const Speaker = z.object({
  id,
  minuteId: id,
  /** 显示名 · 默认「说话人1」· 重命名后存真名 */
  displayName: z.string().min(1).max(64),
  /** 声纹聚类 key · diarization 输出(如 SPEAKER_00) */
  voiceprintKey: z.string().nullable(),
  isRenamed: z.boolean(),
  totalSpeakingMs: ms,
  segmentCount: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  /** 发言占比 0-1 */
  speakingRatio: z.number().min(0).max(1),
  orderIndex: z.number().int().nonnegative(),
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
})
export type Speaker = z.infer<typeof Speaker>

/* ────────────────────────── 转写句段 ────────────────────────── */

export const TranscriptSegment = z.object({
  id,
  minuteId: id,
  speakerId: id.nullable(),
  startMs: ms,
  endMs: ms,
  text: z.string(),
  words: z.array(Word),
  orderIndex: z.number().int().nonnegative(),
  /** 段落分组 id · 同段落连续句段共享 */
  paragraphId: z.string().nullable(),
  isEdited: z.boolean()
})
export type TranscriptSegment = z.infer<typeof TranscriptSegment>

/* ────────────────────────── 翻译 ────────────────────────── */

export const Translation = z.object({
  id,
  segmentId: id,
  targetLang: Lang,
  text: z.string()
})
export type Translation = z.infer<typeof Translation>

/* ────────────────────────── AI 智能纪要 ────────────────────────── */

export const KeyPoint = z.object({
  text: z.string(),
  /** 原文溯源 · 指向句段 · 点击跳转 */
  sourceSegmentId: id.nullable()
})
export type KeyPoint = z.infer<typeof KeyPoint>

export const Summary = z.object({
  id,
  minuteId: id,
  overview: z.string(),
  keyPoints: z.array(KeyPoint),
  risks: z.array(z.string()),
  status: JobStatus,
  createdAt: isoDate
})
export type Summary = z.infer<typeof Summary>

export const Chapter = z.object({
  id,
  minuteId: id,
  title: z.string(),
  startMs: ms,
  endMs: ms,
  summary: z.string(),
  orderIndex: z.number().int().nonnegative()
})
export type Chapter = z.infer<typeof Chapter>

export const Todo = z.object({
  id,
  minuteId: id,
  text: z.string(),
  /** 责任人 · AI 抽取 */
  owner: z.string().nullable(),
  sourceSegmentId: id.nullable(),
  status: TodoStatus,
  /** 推送到外部任务系统后的 id */
  externalTaskId: z.string().nullable(),
  orderIndex: z.number().int().nonnegative()
})
export type Todo = z.infer<typeof Todo>

/* ────────────────────────── 协作:高亮/评论/片段 ────────────────────────── */

export const Highlight = z.object({
  id,
  minuteId: id,
  segmentId: id,
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  createdBy: id,
  createdAt: isoDate
})
export type Highlight = z.infer<typeof Highlight>

export const Comment = z.object({
  id,
  minuteId: id,
  segmentId: id.nullable(),
  charStart: z.number().int().nonnegative().nullable(),
  charEnd: z.number().int().nonnegative().nullable(),
  authorId: id,
  body: z.string().min(1),
  parentId: id.nullable(),
  resolved: z.boolean(),
  createdAt: isoDate
})
export type Comment = z.infer<typeof Comment>

export const Clip = z.object({
  id,
  minuteId: id,
  startMs: ms,
  endMs: ms,
  title: z.string().max(256),
  createdBy: id,
  shareToken: z.string().min(8).max(32),
  linkScope: LinkScope,
  createdAt: isoDate
})
export type Clip = z.infer<typeof Clip>

/* ────────────────────────── 与妙记对话 (Q&A) ────────────────────────── */

export const QaCitation = z.object({
  segmentId: id,
  startMs: ms,
  snippet: z.string()
})
export type QaCitation = z.infer<typeof QaCitation>

export const QaMessage = z.object({
  id,
  threadId: id,
  role: QaRole,
  content: z.string(),
  citations: z.array(QaCitation),
  createdAt: isoDate
})
export type QaMessage = z.infer<typeof QaMessage>

/* ────────────────────────── 权限/协作者 ────────────────────────── */

export const Collaborator = z.object({
  id,
  subjectType: SubjectType,
  subjectId: id,
  principalId: id,
  role: CollaboratorRole,
  createdAt: isoDate
})
export type Collaborator = z.infer<typeof Collaborator>

/* ────────────────────────── 处理流水线 job ────────────────────────── */

export const Job = z.object({
  id,
  minuteId: id,
  stage: JobStage,
  status: JobStatus,
  progress: z.number().min(0).max(1),
  errorMessage: z.string().nullable(),
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
  createdAt: isoDate
})
export type Job = z.infer<typeof Job>

/* ══════════════════════════ API 输入/输出 契约 ══════════════════════════ */

export const CreateMinuteInput = z.object({
  title: z.string().max(256).optional(),
  source: MinuteSource.default('UPLOAD'),
  mediaType: MediaType,
  language: Lang.default('zh'),
  folderId: id.nullable().optional(),
  /** 上传后客户端拿到的存储 key */
  mediaKey: z.string(),
  durationMs: ms.optional(),
  /** 说话人数提示(null/省略=自动检测;指定 2-10 则强制聚类,显著更准) */
  numSpeakers: z.number().int().min(1).max(10).nullable().optional()
})
export type CreateMinuteInput = z.infer<typeof CreateMinuteInput>

export const ListMinutesInput = z.object({
  folderId: id.nullable().optional(),
  query: z.string().optional(),
  status: MinuteStatus.optional(),
  limit: z.number().int().min(1).max(100).default(30),
  offset: z.number().int().min(0).default(0)
})
export type ListMinutesInput = z.infer<typeof ListMinutesInput>

export const EditSegmentInput = z.object({
  segmentId: id,
  text: z.string()
})
export type EditSegmentInput = z.infer<typeof EditSegmentInput>

export const RenameSpeakerInput = z.object({
  speakerId: id,
  displayName: z.string().min(1).max(64)
})
export type RenameSpeakerInput = z.infer<typeof RenameSpeakerInput>

export const CreateClipInput = z.object({
  minuteId: id,
  startMs: ms,
  endMs: ms,
  title: z.string().max(256)
})
export type CreateClipInput = z.infer<typeof CreateClipInput>

export const AddCommentInput = z.object({
  minuteId: id,
  segmentId: id.nullable().optional(),
  charStart: z.number().int().nonnegative().nullable().optional(),
  charEnd: z.number().int().nonnegative().nullable().optional(),
  body: z.string().min(1),
  parentId: id.nullable().optional()
})
export type AddCommentInput = z.infer<typeof AddCommentInput>

export const AddHighlightInput = z.object({
  minuteId: id,
  segmentId: id,
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative()
})
export type AddHighlightInput = z.infer<typeof AddHighlightInput>

export const AskInput = z.object({
  minuteId: id,
  threadId: id.optional(),
  question: z.string().min(1).max(2000)
})
export type AskInput = z.infer<typeof AskInput>

export const ExportFormat = z.enum(['TXT', 'SRT', 'DOCX', 'MD'])
export type ExportFormat = z.infer<typeof ExportFormat>

export const ExportInput = z.object({
  minuteId: id,
  format: ExportFormat,
  includeSpeaker: z.boolean().default(true),
  includeTimestamp: z.boolean().default(true),
  lang: Lang.optional()
})
export type ExportInput = z.infer<typeof ExportInput>

/** 统计面板 · 对齐飞书「查看统计」+ 发言占比 */
export const MinuteStats = z.object({
  owner: z.string(),
  createdAt: isoDate,
  durationMs: ms,
  visitorCount: z.number().int().nonnegative(),
  visitCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  speakers: z.array(
    z.object({
      speakerId: id,
      displayName: z.string(),
      speakingMs: ms,
      wordCount: z.number().int().nonnegative(),
      speakingRatio: z.number().min(0).max(1)
    })
  )
})
export type MinuteStats = z.infer<typeof MinuteStats>

/* ══════════════════════════ ASR 服务契约 (Python ⇄ Node) ══════════════════════════ */
// Python FastAPI ASR/diarization 服务的请求/响应。Node 后端按此调用,Python 按此返回。

export const AsrTranscribeRequest = z.object({
  /** 服务器本地可读的音频文件绝对路径(后端转码产物) */
  audioPath: z.string(),
  language: Lang.default('zh'),
  /** 是否做说话人分离 */
  diarize: z.boolean().default(true),
  /** 期望说话人数(可选,辅助聚类) */
  numSpeakers: z.number().int().min(1).max(20).nullable().default(null),
  /** 进度跟踪 id · 客户端可轮询 ASR 服务 /progress/{jobId} 取真实进度 */
  jobId: z.string().optional()
})
export type AsrTranscribeRequest = z.infer<typeof AsrTranscribeRequest>

/** ASR 返回的原子句段 · 含词级时间戳 + 说话人聚类标签 */
export const AsrSegment = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
  speaker: z.string().nullable(),
  words: z.array(Word)
})
export type AsrSegment = z.infer<typeof AsrSegment>

export const AsrTranscribeResponse = z.object({
  language: z.string(),
  durationSec: z.number().nonnegative(),
  /** 检测到的说话人聚类标签去重列表 */
  speakers: z.array(z.string()),
  segments: z.array(AsrSegment),
  /** 引擎元信息 · 便于审计「是否真跑了模型」 */
  engine: z.object({
    asrModel: z.string(),
    diarized: z.boolean(),
    deviceUsed: z.string()
  }),
  /** 每个说话人簇的声纹向量 {SPEAKER_xx: number[]} · 供声纹库比对/注册 */
  speakerEmbeddings: z.record(z.string(), z.array(z.number())).default({}),
  /** 声纹向量出自哪个模型(如 eres2netv2_zh / campplus_zh)· 跨模型不可比,匹配只比同模型 */
  embeddingModel: z.string().default('')
})
export type AsrTranscribeResponse = z.infer<typeof AsrTranscribeResponse>

/* ══════════════════════════ 详情聚合视图 ══════════════════════════ */
// 前端打开一个妙记时一次性拿到的聚合数据。

export const MinuteDetail = z.object({
  minute: Minute,
  speakers: z.array(Speaker),
  segments: z.array(TranscriptSegment),
  summary: Summary.nullable(),
  chapters: z.array(Chapter),
  todos: z.array(Todo),
  highlights: z.array(Highlight),
  comments: z.array(Comment),
  clips: z.array(Clip),
  jobs: z.array(Job)
})
export type MinuteDetail = z.infer<typeof MinuteDetail>

/* ─────────────────────────── 纯函数工具 ─────────────────────────── */

// 带标点段文本 ↔ 词级时间戳对齐(转写渲染用 · 详见 align-words.ts 头注)
export { alignTextToWords, type AlignedGroup } from './align-words'
