import type { MindElixirData } from 'mind-elixir'

export const PERSISTED_VERSION = 1 as const

export type PersistedMindMap = {
  version: typeof PERSISTED_VERSION
  updatedAt: string
  data: MindElixirData
}

const MAX_NODES = 5000
const MAX_DEPTH = 32

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
  }
}

export function createNewMapData(): MindElixirData {
  return {
    nodeData: {
      id: newId(),
      topic: 'Central Topic',
      root: true,
      children: [],
    },
    direction: 2,
  } as unknown as MindElixirData
}

export function toPersisted(data: MindElixirData): PersistedMindMap {
  return {
    version: PERSISTED_VERSION,
    updatedAt: new Date().toISOString(),
    data,
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const KNOWN_NODE_KEYS = new Set([
  'id',
  'topic',
  'root',
  'children',
  'direction',
  'expanded',
  'parent',
  'style',
  'tags',
])

function validateNode(node: unknown, ids: Set<string>, depth: number): boolean {
  if (!isRecord(node)) return false
  if (typeof node['id'] !== 'string' || node['id'] === '') return false
  if (typeof node['topic'] !== 'string') return false
  if (ids.has(node['id'] as string)) return false
  ids.add(node['id'] as string)
  if (depth > MAX_DEPTH) return false
  for (const key of Object.keys(node)) {
    if (!KNOWN_NODE_KEYS.has(key)) {
      const val = (node as Record<string, unknown>)[key]
      if (typeof val === 'string' && /<script|javascript:|on\w+=/i.test(val)) return false
      return false
    }
  }
  const children = node['children']
  if (children !== undefined) {
    if (!Array.isArray(children)) return false
    for (const c of children) {
      if (!validateNode(c, ids, depth + 1)) return false
    }
  }
  if (ids.size > MAX_NODES) return false
  return true
}

export function validatePersisted(v: unknown): PersistedMindMap | null {
  if (!isRecord(v)) return null
  if (v['version'] !== PERSISTED_VERSION) return null
  if (typeof v['updatedAt'] !== 'string') return null
  const data = v['data']
  if (!isRecord(data)) return null
  const nodeData = (data as Record<string, unknown>)['nodeData']
  if (!isRecord(nodeData)) return null
  const ids = new Set<string>()
  if (!validateNode(nodeData, ids, 0)) return null
  return v as PersistedMindMap
}
