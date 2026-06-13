// 妙记 数据模型 · drizzle(postgresql)
// 对齐 @wuji/miaoji-contracts。所有时间 UTC withTimezone;媒体时间用毫秒整数。

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  doublePrecision
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import type { Word, KeyPoint, QaCitation } from '@wuji/miaoji-contracts'

/* ── 枚举 ── */
export const minuteSourceEnum = pgEnum('minute_source', ['MEETING', 'UPLOAD', 'CLOUD', 'MOBILE_RECORD'])
export const mediaTypeEnum = pgEnum('media_type', ['AUDIO', 'VIDEO'])
export const minuteStatusEnum = pgEnum('minute_status', [
  'UPLOADING',
  'TRANSCODING',
  'TRANSCRIBING',
  'DIARIZING',
  'SEGMENTING',
  'SUMMARIZING',
  'READY',
  'FAILED'
])
export const jobStageEnum = pgEnum('job_stage', [
  'TRANSCODE',
  'ASR',
  'DIARIZE',
  'SEGMENT',
  'SUMMARIZE',
  'INDEX'
])
export const jobStatusEnum = pgEnum('job_status', ['PENDING', 'RUNNING', 'DONE', 'FAILED'])
export const langEnum = pgEnum('lang', ['zh', 'en', 'ja'])
export const todoStatusEnum = pgEnum('todo_status', ['OPEN', 'DONE', 'CANCELLED'])
export const subjectTypeEnum = pgEnum('subject_type', ['MINUTE', 'FOLDER', 'CLIP'])
export const collaboratorRoleEnum = pgEnum('collaborator_role', ['VIEWER', 'COMMENTER', 'EDITOR', 'MANAGER'])
export const linkScopeEnum = pgEnum('link_scope', ['CLOSED', 'TENANT_VIEW', 'TENANT_EDIT', 'ANYONE_VIEW'])
export const qaRoleEnum = pgEnum('qa_role', ['user', 'assistant'])

/* ── 用户 ── */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 64 }).notNull(),
  email: varchar('email', { length: 256 }),
  avatarUrl: varchar('avatar_url', { length: 1024 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

/* ── 文件夹 ── */
export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 128 }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    parentId: uuid('parent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  t => ({
    ownerIdx: index('folders_owner_idx').on(t.ownerId),
    parentIdx: index('folders_parent_idx').on(t.parentId)
  })
)

/* ── 妙记 ── */
export const minutes = pgTable(
  'minutes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: varchar('token', { length: 32 }).notNull().unique(),
    ownerId: uuid('owner_id').notNull(),
    folderId: uuid('folder_id'),
    title: varchar('title', { length: 256 }).notNull().default(''),
    cover: varchar('cover', { length: 1024 }),
    source: minuteSourceEnum('source').notNull().default('UPLOAD'),
    mediaType: mediaTypeEnum('media_type').notNull(),
    mediaKey: varchar('media_key', { length: 1024 }),
    playableKey: varchar('playable_key', { length: 1024 }),
    durationMs: bigint('duration_ms', { mode: 'number' }).notNull().default(0),
    language: langEnum('language').notNull().default('zh'),
    numSpeakers: integer('num_speakers'), // 说话人数提示(null=自动检测;指定则强制聚类,更准)
    status: minuteStatusEnum('status').notNull().default('UPLOADING'),
    errorMessage: text('error_message'),
    visitorCount: integer('visitor_count').notNull().default(0),
    visitCount: integer('visit_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    quotaMinutes: integer('quota_minutes').notNull().default(0),
    linkScope: linkScopeEnum('link_scope').notNull().default('CLOSED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  t => ({
    ownerIdx: index('minutes_owner_idx').on(t.ownerId),
    folderIdx: index('minutes_folder_idx').on(t.folderId),
    statusIdx: index('minutes_status_idx').on(t.status)
  })
)

/* ── 说话人 ── */
export const speakers = pgTable(
  'speakers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    minuteId: uuid('minute_id').notNull(),
    displayName: varchar('display_name', { length: 64 }).notNull(),
    voiceprintKey: varchar('voiceprint_key', { length: 64 }),
    isRenamed: boolean('is_renamed').notNull().default(false),
    totalSpeakingMs: bigint('total_speaking_ms', { mode: 'number' }).notNull().default(0),
    segmentCount: integer('segment_count').notNull().default(0),
    wordCount: integer('word_count').notNull().default(0),
    speakingRatio: doublePrecision('speaking_ratio').notNull().default(0),
    orderIndex: integer('order_index').notNull().default(0),
    colorHex: varchar('color_hex', { length: 7 }),
    // 声纹:该说话人簇的声纹向量(用于跨会议比对/注册) + 命中的声纹库条目 + 向量出自哪个模型
    embedding: jsonb('embedding').$type<number[]>(),
    embeddingModel: varchar('embedding_model', { length: 64 }),
    voiceprintId: uuid('voiceprint_id')
  },
  t => ({
    minuteIdx: index('speakers_minute_idx').on(t.minuteId)
  })
)

/* ── 声纹库(跨会议复用 · 命中即自动命名说话人)── */
export const voiceprints = pgTable(
  'voiceprints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    // 声纹中心向量(L2 归一化 · = samples 的归一化均值)· 快路匹配用
    embedding: jsonb('embedding').$type<number[]>().notNull(),
    sampleCount: integer('sample_count').notNull().default(1),
    // 声纹模型 id(如 eres2netv2_zh)· 跨模型向量不可比,匹配只比同模型(换模型 → 旧声纹失配需重录)
    embeddingModel: varchar('embedding_model', { length: 64 }).notNull().default('campplus_zh'),
    // 多样本抗噪(v2):每个身份保留 ≤K 条高质量原始声纹(不同场合/状态)·匹配取与中心+各样本的最大余弦
    // (Sub-center ArcFace 部署期等价:一条坏样本不污染整体)。每条带质量度量+模型 id,满 K 时淘汰最低质量。
    samples: jsonb('samples')
      .$type<
        {
          emb: number[]
          model: string
          speechSec: number
          snrDb: number
          source: 'recording' | 'meeting'
          at: string
        }[]
      >()
      .notNull()
      .default([]),
    enrolledFromMinuteId: uuid('enrolled_from_minute_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  t => ({
    ownerIdx: index('voiceprints_owner_idx').on(t.ownerId)
  })
)

/* ── 转写句段 ── */
export const segments = pgTable(
  'segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    minuteId: uuid('minute_id').notNull(),
    speakerId: uuid('speaker_id'),
    startMs: bigint('start_ms', { mode: 'number' }).notNull(),
    endMs: bigint('end_ms', { mode: 'number' }).notNull(),
    text: text('text').notNull().default(''),
    words: jsonb('words').$type<Word[]>().notNull().default([]),
    orderIndex: integer('order_index').notNull(),
    paragraphId: varchar('paragraph_id', { length: 64 }),
    isEdited: boolean('is_edited').notNull().default(false)
  },
  t => ({
    minuteOrderIdx: index('segments_minute_order_idx').on(t.minuteId, t.orderIndex),
    speakerIdx: index('segments_speaker_idx').on(t.speakerId)
  })
)

/* ── 翻译 ── */
export const translations = pgTable(
  'translations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    segmentId: uuid('segment_id').notNull(),
    targetLang: langEnum('target_lang').notNull(),
    text: text('text').notNull()
  },
  t => ({
    segLangIdx: uniqueIndex('translations_seg_lang_idx').on(t.segmentId, t.targetLang)
  })
)

/* ── AI 智能纪要 ── */
export const summaries = pgTable('summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  minuteId: uuid('minute_id').notNull().unique(),
  overview: text('overview').notNull().default(''),
  keyPoints: jsonb('key_points').$type<KeyPoint[]>().notNull().default([]),
  risks: jsonb('risks').$type<string[]>().notNull().default([]),
  status: jobStatusEnum('status').notNull().default('PENDING'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const chapters = pgTable(
  'chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    minuteId: uuid('minute_id').notNull(),
    title: varchar('title', { length: 256 }).notNull(),
    startMs: bigint('start_ms', { mode: 'number' }).notNull(),
    endMs: bigint('end_ms', { mode: 'number' }).notNull(),
    summary: text('summary').notNull().default(''),
    orderIndex: integer('order_index').notNull()
  },
  t => ({
    minuteIdx: index('chapters_minute_idx').on(t.minuteId, t.orderIndex)
  })
)

export const todos = pgTable(
  'todos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    minuteId: uuid('minute_id').notNull(),
    text: text('text').notNull(),
    owner: varchar('owner', { length: 64 }),
    sourceSegmentId: uuid('source_segment_id'),
    status: todoStatusEnum('status').notNull().default('OPEN'),
    externalTaskId: varchar('external_task_id', { length: 128 }),
    orderIndex: integer('order_index').notNull().default(0)
  },
  t => ({
    minuteIdx: index('todos_minute_idx').on(t.minuteId)
  })
)

/* ── 协作:高亮/评论/片段 ── */
export const highlights = pgTable(
  'highlights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    minuteId: uuid('minute_id').notNull(),
    segmentId: uuid('segment_id').notNull(),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  t => ({
    minuteIdx: index('highlights_minute_idx').on(t.minuteId)
  })
)

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    minuteId: uuid('minute_id').notNull(),
    segmentId: uuid('segment_id'),
    charStart: integer('char_start'),
    charEnd: integer('char_end'),
    authorId: uuid('author_id').notNull(),
    body: text('body').notNull(),
    parentId: uuid('parent_id'),
    resolved: boolean('resolved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  t => ({
    minuteIdx: index('comments_minute_idx').on(t.minuteId),
    segmentIdx: index('comments_segment_idx').on(t.segmentId)
  })
)

export const clips = pgTable(
  'clips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    minuteId: uuid('minute_id').notNull(),
    startMs: bigint('start_ms', { mode: 'number' }).notNull(),
    endMs: bigint('end_ms', { mode: 'number' }).notNull(),
    title: varchar('title', { length: 256 }).notNull().default(''),
    createdBy: uuid('created_by').notNull(),
    shareToken: varchar('share_token', { length: 32 }).notNull().unique(),
    linkScope: linkScopeEnum('link_scope').notNull().default('CLOSED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  t => ({
    minuteIdx: index('clips_minute_idx').on(t.minuteId)
  })
)

/* ── 与妙记对话 ── */
export const qaThreads = pgTable(
  'qa_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    minuteId: uuid('minute_id').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  t => ({
    minuteIdx: index('qa_threads_minute_idx').on(t.minuteId)
  })
)

export const qaMessages = pgTable(
  'qa_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id').notNull(),
    role: qaRoleEnum('role').notNull(),
    content: text('content').notNull(),
    citations: jsonb('citations').$type<QaCitation[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  t => ({
    threadIdx: index('qa_messages_thread_idx').on(t.threadId)
  })
)

/* ── 权限/协作者 ── */
export const collaborators = pgTable(
  'collaborators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectType: subjectTypeEnum('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    principalId: uuid('principal_id').notNull(),
    role: collaboratorRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  t => ({
    subjectIdx: index('collaborators_subject_idx').on(t.subjectType, t.subjectId),
    uniq: uniqueIndex('collaborators_subject_principal_idx').on(t.subjectType, t.subjectId, t.principalId)
  })
)

/* ── 处理流水线 job ── */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    minuteId: uuid('minute_id').notNull(),
    stage: jobStageEnum('stage').notNull(),
    status: jobStatusEnum('status').notNull().default('PENDING'),
    progress: doublePrecision('progress').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  t => ({
    minuteStageIdx: index('jobs_minute_stage_idx').on(t.minuteId, t.stage),
    statusIdx: index('jobs_status_idx').on(t.status)
  })
)

/* ── relations ── */
export const minutesRelations = relations(minutes, ({ many }) => ({
  speakers: many(speakers),
  segments: many(segments),
  chapters: many(chapters),
  todos: many(todos),
  highlights: many(highlights),
  comments: many(comments),
  clips: many(clips),
  jobs: many(jobs)
}))

export const speakersRelations = relations(speakers, ({ one, many }) => ({
  minute: one(minutes, { fields: [speakers.minuteId], references: [minutes.id] }),
  segments: many(segments)
}))

export const segmentsRelations = relations(segments, ({ one, many }) => ({
  minute: one(minutes, { fields: [segments.minuteId], references: [minutes.id] }),
  speaker: one(speakers, { fields: [segments.speakerId], references: [speakers.id] }),
  translations: many(translations)
}))

export const qaThreadsRelations = relations(qaThreads, ({ many }) => ({
  messages: many(qaMessages)
}))
