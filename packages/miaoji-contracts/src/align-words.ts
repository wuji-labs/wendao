// 把带标点的段文本对齐回词级时间戳 · 纯函数
// 背景:ASR 词级时间戳(whisper words)不含标点;标点由 ct-transformer 事后写进
// segment.text。转写视图若直接 join words 渲染(跟读高亮/点词跳转),标点全丢——
// 2026-06-12 真案:库里标点齐全,UI 无标点,「修了好多遍 ASR」全打空。
// 此函数把 text 的每个字符归属到某个词:词字符按序匹配,未匹配字符(标点/空白)
// 挂到前一个词的时间片;文本与词序列对不上(如人工编辑过)→ 返回 null,调用方
// 退回纯文本渲染(标点仍在,只失去逐词高亮)。

export interface AlignedGroup {
  /** 该词 + 其后跟随的标点/空白 */
  text: string
  /** 指向 words 下标(取时间戳/点击跳转) */
  wordIdx: number
  /** 组首字符在 seg.text 中的偏移(高亮区间判定用) */
  charStart: number
}

export function alignTextToWords(text: string, words: { w: string }[]): AlignedGroup[] | null {
  if (!text || words.length === 0) return null

  // 1) 每个字符的归属:按序贪婪匹配词字符;不匹配的标记 -1
  const owner = new Array<number>(text.length)
  let wi = 0
  let wc = 0
  for (let i = 0; i < text.length; i++) {
    while (wi < words.length && wc >= words[wi]!.w.length) {
      wi++
      wc = 0
    }
    if (wi < words.length && text[i] === words[wi]!.w[wc]) {
      owner[i] = wi
      wc++
    } else {
      owner[i] = -1
    }
  }
  while (wi < words.length && wc >= words[wi]!.w.length) {
    wi++
    wc = 0
  }
  // 词没被文本完整消费 = 对不上(编辑过/数据异常),放弃对齐
  if (wi < words.length) return null

  // 2) 归属传播:未匹配字符挂前一个词;开头的标点挂第一个词
  let prev = -1
  for (let i = 0; i < text.length; i++) {
    if (owner[i] === -1) owner[i] = prev
    else prev = owner[i]!
  }
  for (let i = text.length - 1; i >= 0; i--) {
    if (owner[i] === -1) owner[i] = i + 1 < text.length ? owner[i + 1]! : 0
  }

  // 3) 连续同词字符合组
  const groups: AlignedGroup[] = []
  for (let i = 0; i < text.length; i++) {
    const last = groups[groups.length - 1]
    if (last && last.wordIdx === owner[i]) {
      last.text += text[i]!
    } else {
      groups.push({ text: text[i]!, wordIdx: owner[i]!, charStart: i })
    }
  }
  return groups
}
