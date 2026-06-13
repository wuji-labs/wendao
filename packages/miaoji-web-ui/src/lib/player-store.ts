'use client'
import { useSyncExternalStore } from 'react'

/** 共享播放状态 · 模块单例 · 无外部状态库 · 供转写与播放器无 prop-drill 同步 */

export interface PlayerSnapshot {
  currentMs: number
  durationMs: number
  playing: boolean
  rate: number
}

type Listener = () => void

let snapshot: PlayerSnapshot = {
  currentMs: 0,
  durationMs: 0,
  playing: false,
  rate: 1
}

const listeners = new Set<Listener>()
let mediaEl: HTMLMediaElement | null = null
let rafId: number | null = null

function emit(): void {
  for (const l of listeners) l()
}

/** 仅在确有变化时换引用 · 避免 useSyncExternalStore 无谓重渲染 */
function commit(next: Partial<PlayerSnapshot>): void {
  const merged: PlayerSnapshot = { ...snapshot, ...next }
  if (
    merged.currentMs === snapshot.currentMs &&
    merged.durationMs === snapshot.durationMs &&
    merged.playing === snapshot.playing &&
    merged.rate === snapshot.rate
  ) {
    return
  }
  snapshot = merged
  emit()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): PlayerSnapshot {
  return snapshot
}

/** rAF 循环驱动 currentMs · 保证 karaoke 平滑 */
function tick(): void {
  if (mediaEl && !mediaEl.paused) {
    commit({ currentMs: Math.floor(mediaEl.currentTime * 1000) })
    rafId = requestAnimationFrame(tick)
  } else {
    rafId = null
  }
}

function startRaf(): void {
  if (rafId === null) rafId = requestAnimationFrame(tick)
}

function stopRaf(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

function onTimeUpdate(): void {
  if (mediaEl) commit({ currentMs: Math.floor(mediaEl.currentTime * 1000) })
}

function onLoadedMeta(): void {
  if (mediaEl && Number.isFinite(mediaEl.duration)) {
    commit({ durationMs: Math.floor(mediaEl.duration * 1000) })
  }
}

function onPlay(): void {
  commit({ playing: true })
  startRaf()
}

function onPause(): void {
  commit({ playing: false })
  stopRaf()
}

function onRateChange(): void {
  if (mediaEl) commit({ rate: mediaEl.playbackRate })
}

/** 注册媒体元素 · 返回注销函数(组件卸载时调) */
export function register(el: HTMLMediaElement): () => void {
  if (mediaEl === el) return () => detach()
  detach()
  mediaEl = el
  el.addEventListener('timeupdate', onTimeUpdate)
  el.addEventListener('loadedmetadata', onLoadedMeta)
  el.addEventListener('durationchange', onLoadedMeta)
  el.addEventListener('play', onPlay)
  el.addEventListener('playing', onPlay)
  el.addEventListener('pause', onPause)
  el.addEventListener('ended', onPause)
  el.addEventListener('ratechange', onRateChange)
  onLoadedMeta()
  commit({ playing: !el.paused, rate: el.playbackRate, currentMs: Math.floor(el.currentTime * 1000) })
  return () => detach()
}

function detach(): void {
  if (!mediaEl) return
  const el = mediaEl
  el.removeEventListener('timeupdate', onTimeUpdate)
  el.removeEventListener('loadedmetadata', onLoadedMeta)
  el.removeEventListener('durationchange', onLoadedMeta)
  el.removeEventListener('play', onPlay)
  el.removeEventListener('playing', onPlay)
  el.removeEventListener('pause', onPause)
  el.removeEventListener('ended', onPause)
  el.removeEventListener('ratechange', onRateChange)
  stopRaf()
  mediaEl = null
}

/** 跳转到 ms 并播放 */
export function seek(ms: number): void {
  if (!mediaEl) {
    commit({ currentMs: Math.max(0, ms) })
    return
  }
  mediaEl.currentTime = Math.max(0, ms) / 1000
  commit({ currentMs: Math.max(0, ms) })
  void mediaEl.play().catch(() => {
    /* 自动播放可能被浏览器策略拒绝 · 静默 */
  })
}

/** 仅跳转不强制播放 */
export function seekOnly(ms: number): void {
  if (!mediaEl) {
    commit({ currentMs: Math.max(0, ms) })
    return
  }
  mediaEl.currentTime = Math.max(0, ms) / 1000
  commit({ currentMs: Math.max(0, ms) })
}

export function togglePlay(): void {
  if (!mediaEl) return
  if (mediaEl.paused) void mediaEl.play().catch(() => {})
  else mediaEl.pause()
}

export function setRate(r: number): void {
  if (mediaEl) mediaEl.playbackRate = r
  commit({ rate: r })
}

const actions = { register, seek, seekOnly, togglePlay, setRate } as const

export type PlayerActions = typeof actions

/** 组件内取 snapshot + actions */
export function usePlayer(): PlayerSnapshot & PlayerActions {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { ...snap, ...actions }
}
