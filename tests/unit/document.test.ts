// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  PERSISTED_VERSION,
  createNewMapData,
  toPersisted,
  validatePersisted,
} from '../../src/storage/document'

function node(id: string, topic: string, children: unknown[] = []) {
  return { id, topic, children }
}

describe('document', () => {
  it('round-trips created map data', () => {
    const data = createNewMapData()
    const persisted = toPersisted(data as never)
    expect(persisted.version).toBe(PERSISTED_VERSION)
    expect(typeof persisted.updatedAt).toBe('string')
    const back = validatePersisted(persisted)
    expect(back).not.toBeNull()
    expect(back?.version).toBe(1)
  })

  it('rejects version mismatch', () => {
    const data = createNewMapData()
    const persisted = { ...(toPersisted(data as never) as unknown as Record<string, unknown>), version: 2 }
    expect(validatePersisted(persisted)).toBeNull()
  })

  it('rejects duplicate ids', () => {
    const v = {
      version: 1,
      updatedAt: new Date().toISOString(),
      data: { nodeData: node('a', 'root', [node('a', 'dup')]) },
    }
    expect(validatePersisted(v)).toBeNull()
  })

  it('rejects non-string topic', () => {
    const v = {
      version: 1,
      updatedAt: new Date().toISOString(),
      data: { nodeData: node('a', 123 as unknown as string) },
    }
    expect(validatePersisted(v)).toBeNull()
  })

  it('rejects unknown key with script payload', () => {
    const bad = { id: 'a', topic: 'root', children: [], evil: '<script>alert(1)</script>' }
    const v = {
      version: 1,
      updatedAt: new Date().toISOString(),
      data: { nodeData: bad },
    }
    expect(validatePersisted(v)).toBeNull()
  })

  it('rejects unknown key with javascript: payload', () => {
    const bad = { id: 'a', topic: 'root', children: [], evil: 'javascript:alert(1)' }
    const v = {
      version: 1,
      updatedAt: new Date().toISOString(),
      data: { nodeData: bad },
    }
    expect(validatePersisted(v)).toBeNull()
  })

  it('accepts normal nested data and rejects excessive depth', () => {
    const normal = {
      version: 1,
      updatedAt: new Date().toISOString(),
      data: { nodeData: node('root', 'root', [node('c1', 'child', [node('c2', 'grandchild')])]) },
    }
    expect(validatePersisted(normal)).not.toBeNull()

    // Build a chain deeper than MAX_DEPTH (32)
    let deep: Record<string, unknown> = { id: 'deep-40', topic: 'leaf', children: [] }
    for (let i = 39; i >= 0; i--) {
      deep = { id: `deep-${i}`, topic: `n${i}`, children: [deep] }
    }
    const tooDeep = {
      version: 1,
      updatedAt: new Date().toISOString(),
      data: { nodeData: deep },
    }
    expect(validatePersisted(tooDeep)).toBeNull()
  })

  it('accepts normal size and rejects node count over limit', () => {
    const small = {
      version: 1,
      updatedAt: new Date().toISOString(),
      data: { nodeData: node('root', 'root', [node('c1', 'a'), node('c2', 'b')]) },
    }
    expect(validatePersisted(small)).not.toBeNull()

    const many: unknown[] = []
    for (let i = 0; i < 6000; i++) {
      many.push({ id: `n-${i}`, topic: `t${i}`, children: [] })
    }
    const tooMany = {
      version: 1,
      updatedAt: new Date().toISOString(),
      data: { nodeData: { id: 'root', topic: 'root', children: many } },
    }
    expect(validatePersisted(tooMany)).toBeNull()
  })
})
