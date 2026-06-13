import { miaojiConfig } from './config'

export interface UploadResult {
  mediaKey: string
  filename: string
  mediaType: 'AUDIO' | 'VIDEO'
}

/** 上传媒体到 miaoji-api /upload,带进度回调。
 * 大文件(会议 WAV 常达数百 MB)直连 API 源(apiBase),绕开 Next dev 代理 ~30s 超时致 Premature close;
 * apiBase 为空时走同源 uploadUrl(生产经反代)。 */
export function uploadMedia(file: File, onProgress?: (pct: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    const xhr = new XMLHttpRequest()
    const target = miaojiConfig.apiBase
      ? `${miaojiConfig.apiBase.replace(/\/$/, '')}${miaojiConfig.uploadUrl}`
      : miaojiConfig.uploadUrl
    xhr.open('POST', target)
    xhr.setRequestHeader('x-user-id', miaojiConfig.userId)
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResult)
        } catch {
          reject(new Error('上传响应解析失败'))
        }
      } else {
        reject(new Error(`上传失败 (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('上传网络错误'))
    xhr.send(form)
  })
}
