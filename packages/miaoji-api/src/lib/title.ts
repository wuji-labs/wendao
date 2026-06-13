// minute 标题兜底:用户没填标题时,用录音文件名(去扩展名)作标题。
// mediaKey 形如 uploads/<uuid>/<原始文件名>(见 server.ts /upload)。
// 主器定(2026-06-12):导出文件名与库/详情大标题都要与录音文件名一致——
// 导出名取自 title(export.ts),故标题对齐文件名即两处同治。

/** 从 mediaKey 提取录音文件名(去扩展名);提不出返回 ''。 */
export function titleFromMediaKey(mediaKey: string): string {
  const base = mediaKey.split('/').pop() ?? ''
  return base.replace(/\.[^.]+$/, '').trim()
}
