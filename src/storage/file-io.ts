import type { PersistedMindMap } from './document.js'

export async function readJsonFile(file: File, maxBytes = 5 * 1024 * 1024): Promise<unknown> {
  if (file.size > maxBytes) throw new Error(`File is too large (>${maxBytes} bytes)`)
  const text = await file.text()
  return JSON.parse(text) as unknown
}

export function buildExportFilename(now = new Date()): string {
  const pad = (v: number): string => String(v).padStart(2, '0')
  return (
    `mindmap-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`
  )
}

export function downloadJson(filename: string, persisted: PersistedMindMap): void {
  const blob = new Blob([JSON.stringify(persisted, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
