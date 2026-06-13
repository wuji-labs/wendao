// Demo seed · creates one READY minute (synthetic audio + word-level transcript + real Ollama AI minutes).
// Lets you verify the full UI end-to-end without an ASR model. Run: tsx --env-file=.env src/seed/demo.ts
import { spawn } from 'node:child_process'
import { eq } from 'drizzle-orm'
import { db, sql } from '../db/index.js'
import { users, minutes, speakers, segments, summaries, chapters, todos } from '../db/schema.js'
import { pathForKey, ensureDir } from '../lib/storage.js'
import { config } from '../lib/config.js'
import { assembleTranscript } from '../pipeline/assemble.js'
import {
  generateSummary,
  generateChapters,
  generateTodos,
  type TranscriptLine
} from '../pipeline/ai-tasks.js'
import type { AsrSegment, AsrTranscribeResponse, Word } from '@wuji/miaoji-contracts'

const DEV_USER = '00000000-0000-0000-0000-000000000001'
const TOKEN = 'demoproductmtg01'

// A fictional product standup (two speakers) — used purely to populate the demo UI.
const SCRIPT: { speaker: string; start: number; end: number; text: string }[] = [
  { speaker: 'SPEAKER_00', start: 0, end: 6, text: '各位早上好,我们先过一下这周转写产品的进展。' },
  {
    speaker: 'SPEAKER_01',
    start: 6.2,
    end: 13,
    text: '好的,上传和转码的后端已经联调通过了,大文件走的是分片直传。'
  },
  { speaker: 'SPEAKER_00', start: 13.5, end: 19, text: '那转写详情页什么时候能上?这块阻塞了几个测试用例。' },
  {
    speaker: 'SPEAKER_01',
    start: 19.3,
    end: 26,
    text: '前端预计这周五能提测,词级时间戳和卡拉OK高亮已经跑通了。'
  },
  {
    speaker: 'SPEAKER_00',
    start: 26.5,
    end: 33,
    text: '提测前一定要把长音频的播放拖动跑顺,上次就是因为 Range 请求没处理好。'
  },
  {
    speaker: 'SPEAKER_01',
    start: 33.4,
    end: 40,
    text: '明白,我加一个静态服务的 Range 支持,顺便把倍速播放也接上。'
  },
  {
    speaker: 'SPEAKER_00',
    start: 40.5,
    end: 47,
    text: '另外说话人分离这块,本周要做一次端到端验证,确认重命名能落库。'
  },
  {
    speaker: 'SPEAKER_01',
    start: 47.3,
    end: 54,
    text: '声纹聚类和重命名都跑通了,风险是说话人分离还要等模型下载完成。'
  },
  { speaker: 'SPEAKER_00', start: 54.5, end: 60, text: '那就先把能验的验掉,模型这块下周再排,今天先到这里。' }
]

function splitWords(text: string, start: number, end: number): Word[] {
  // 中文按 2-3 字切块,均匀分配时间(近似词级时间戳)
  const chunks: string[] = []
  let buf = ''
  for (const ch of text) {
    buf += ch
    if (buf.length >= 3 || /[,。!?、]/.test(ch)) {
      chunks.push(buf)
      buf = ''
    }
  }
  if (buf) chunks.push(buf)
  const span = (end - start) / Math.max(1, chunks.length)
  return chunks.map((w, i) => ({
    w,
    start: +(start + i * span).toFixed(2),
    end: +(start + (i + 1) * span).toFixed(2)
  }))
}

function ff(args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const c = spawn(config.ffmpeg, args, { windowsHide: true })
    let err = ''
    c.stderr.on('data', d => (err += d))
    c.on('error', rej)
    c.on('close', code => (code === 0 ? res() : rej(new Error(err))))
  })
}

async function main() {
  console.log('seed: dev user')
  await db
    .insert(users)
    .values({ id: DEV_USER, name: '开发者', email: null, avatarUrl: null })
    .onConflictDoNothing({ target: users.id })

  // 清旧
  const old = await db.query.minutes.findFirst({ where: eq(minutes.token, TOKEN) })
  if (old) {
    for (const t of [segments, speakers, summaries, chapters, todos])
      await db.delete(t).where(eq((t as typeof segments).minuteId, old.id))
    await db.delete(minutes).where(eq(minutes.id, old.id))
  }

  const durationMs = 60000
  const playableKey = `derived/${TOKEN}/playable.m4a`
  const playablePath = pathForKey(playableKey)
  await ensureDir(playablePath)
  console.log('seed: generating 60s demo audio via ffmpeg →', playablePath)
  await ff([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=60',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    playablePath
  ])

  const [m] = await db
    .insert(minutes)
    .values({
      token: TOKEN,
      ownerId: DEV_USER,
      title: '产品周会 · Wendao 演示',
      source: 'UPLOAD',
      mediaType: 'AUDIO',
      mediaKey: null,
      playableKey,
      durationMs,
      language: 'zh',
      status: 'READY',
      linkScope: 'TENANT_VIEW'
    })
    .returning()
  if (!m) throw new Error('seed: minute 创建失败')

  // 用流水线同款 assemble 把脚本变成 speakers + segments
  const asr: AsrTranscribeResponse = {
    language: 'zh',
    durationSec: 60,
    speakers: ['SPEAKER_00', 'SPEAKER_01'],
    speakerEmbeddings: {},
    embeddingModel: '',
    segments: SCRIPT.map<AsrSegment>(s => ({
      start: s.start,
      end: s.end,
      text: s.text,
      speaker: s.speaker,
      words: splitWords(s.text, s.start, s.end)
    })),
    engine: { asrModel: 'seed', diarized: true, deviceUsed: 'seed' }
  }
  const asm = assembleTranscript(asr)
  const keyToId = new Map<string | null, string>()
  for (const sp of asm.speakers) {
    const [row] = await db
      .insert(speakers)
      .values({
        minuteId: m.id,
        displayName: sp.displayName,
        voiceprintKey: sp.voiceprintKey,
        totalSpeakingMs: sp.totalSpeakingMs,
        segmentCount: sp.segmentCount,
        wordCount: sp.wordCount,
        speakingRatio: sp.speakingRatio,
        orderIndex: sp.orderIndex,
        colorHex: sp.colorHex
      })
      .returning({ id: speakers.id })
    if (!row) throw new Error('seed: speaker 创建失败')
    keyToId.set(sp.voiceprintKey, row.id)
  }
  await db.insert(segments).values(
    asm.segments.map(s => ({
      minuteId: m.id,
      speakerId: keyToId.get(s.speakerVoiceprintKey) ?? null,
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text,
      words: s.words,
      orderIndex: s.orderIndex,
      paragraphId: s.paragraphId
    }))
  )
  console.log(`seed: ${asm.speakers.length} speakers · ${asm.segments.length} segments`)

  // 真 Ollama 生成智能纪要
  const segRows = await db.query.segments.findMany({
    where: eq(segments.minuteId, m.id),
    orderBy: (s, { asc }) => [asc(s.orderIndex)]
  })
  const spRows = await db.query.speakers.findMany({ where: eq(speakers.minuteId, m.id) })
  const name = new Map(spRows.map(s => [s.id, s.displayName]))
  const lineToSeg = new Map<number, string>()
  const lineToStart = new Map<number, number>()
  const lines: TranscriptLine[] = segRows.map((s, i) => {
    lineToSeg.set(i + 1, s.id)
    lineToStart.set(i + 1, s.startMs)
    return {
      lineNo: i + 1,
      speaker: s.speakerId ? (name.get(s.speakerId) ?? '说话人') : '说话人',
      startMs: s.startMs,
      text: s.text
    }
  })

  console.log('seed: calling Ollama for summary/chapters/todos (real)...')
  try {
    const [sum, chaps, tds] = await Promise.all([
      generateSummary(lines),
      generateChapters(lines),
      generateTodos(lines)
    ])
    await db.insert(summaries).values({
      minuteId: m.id,
      overview: sum.overview,
      keyPoints: sum.keyPoints.map(k => ({
        text: k.text,
        sourceSegmentId: k.sourceLineNo ? (lineToSeg.get(k.sourceLineNo) ?? null) : null
      })),
      risks: sum.risks,
      status: 'DONE'
    })
    if (chaps.length)
      await db.insert(chapters).values(
        chaps.map((c, i) => ({
          minuteId: m.id,
          title: c.title,
          startMs: lineToStart.get(c.startLineNo) ?? 0,
          endMs: lineToStart.get(c.endLineNo) ?? durationMs,
          summary: c.summary,
          orderIndex: i
        }))
      )
    if (tds.length)
      await db.insert(todos).values(
        tds.map((t, i) => ({
          minuteId: m.id,
          text: t.text,
          owner: t.owner,
          sourceSegmentId: t.sourceLineNo ? (lineToSeg.get(t.sourceLineNo) ?? null) : null,
          orderIndex: i
        }))
      )
    console.log(
      `seed: AI done · overview ${sum.overview.length}字 · ${chaps.length} chapters · ${tds.length} todos`
    )
  } catch (e) {
    console.warn('seed: Ollama 生成失败(跳过,转写仍可用):', (e as Error).message)
  }

  console.log(`\n✅ demo minute ready · token=${TOKEN}`)
  console.log(`   open: http://localhost:3101/m/${TOKEN}`)
  await sql.end()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
