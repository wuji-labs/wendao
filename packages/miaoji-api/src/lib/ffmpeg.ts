// ffmpeg/ffprobe 封装 · 转码、抽音轨、探测时长、生成封面缩略图。
import { spawn } from 'node:child_process'
import { config } from './config.js'

function run(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout += d.toString()))
    child.stderr.on('data', d => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', code => resolvePromise({ code: code ?? -1, stdout, stderr }))
  })
}

/** 探测媒体时长(毫秒)与是否含视频流 */
export async function probe(inputPath: string): Promise<{ durationMs: number; hasVideo: boolean }> {
  const { stdout, code, stderr } = await run(config.ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type',
    '-of',
    'json',
    inputPath
  ])
  if (code !== 0) throw new Error(`ffprobe failed: ${stderr}`)
  const json = JSON.parse(stdout) as {
    format?: { duration?: string }
    streams?: { codec_type?: string }[]
  }
  const durationSec = Number(json.format?.duration ?? 0)
  const hasVideo = (json.streams ?? []).some(s => s.codec_type === 'video')
  return { durationMs: Math.round(durationSec * 1000), hasVideo }
}

/** 抽出 16k 单声道 wav · ASR 输入标准 */
export async function extractAudioWav(inputPath: string, outPath: string): Promise<void> {
  const { code, stderr } = await run(config.ffmpeg, [
    '-y',
    '-i',
    inputPath,
    '-vn',
    // 动态响度归一:拉平不同人/远近的音量差,提升弱声说话人转写准确率
    '-af',
    'dynaudnorm=f=200:g=11:p=0.9',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    outPath
  ])
  if (code !== 0) throw new Error(`ffmpeg extractAudio failed: ${stderr}`)
}

/** 转成可直接 web 播放的 mp4(视频)或 m4a(音频)。
 *  播放响度标准化:EBU R128 loudnorm 到 -16 LUFS(播客/会议行业标准)——
 *  会议录音常整体偏小且人与人音量不一,统一到标准响度,播放不用手动拧音量。 */
export async function toPlayable(inputPath: string, outPath: string, hasVideo: boolean): Promise<void> {
  const loudnorm = 'loudnorm=I=-16:TP=-1.5:LRA=11'
  const args = hasVideo
    ? [
        '-y',
        '-i',
        inputPath,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '24',
        '-af',
        loudnorm,
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        outPath
      ]
    : ['-y', '-i', inputPath, '-vn', '-af', loudnorm, '-c:a', 'aac', '-b:a', '128k', outPath]
  const { code, stderr } = await run(config.ffmpeg, args)
  if (code !== 0) throw new Error(`ffmpeg toPlayable failed: ${stderr}`)
}

/** 取首帧封面(视频) */
export async function grabCover(inputPath: string, outPath: string, atSec = 1): Promise<void> {
  const { code } = await run(config.ffmpeg, [
    '-y',
    '-ss',
    String(atSec),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    outPath
  ])
  if (code !== 0) {
    // 封面失败不致命
  }
}
