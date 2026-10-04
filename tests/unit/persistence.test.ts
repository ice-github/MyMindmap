// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindElixirData } from 'mind-elixir'
import { MapPersistence } from '../../src/storage/persistence'

function mapData(topic: string): MindElixirData {
  return {
    nodeData: { id: `id-${topic}`, topic, root: true, children: [] },
  } as unknown as MindElixirData
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('MapPersistence (in-memory fallback)', () => {
  it('round-trips saveNow to load', async () => {
    const p = new MapPersistence()
    const data = mapData('hello')
    await p.saveNow(data)
    const loaded = await p.load()
    expect(loaded).not.toBeNull()
    expect((loaded?.data as unknown as { nodeData: { topic: string } }).nodeData.topic).toBe('hello')
  })

  it('debounces saveQueued', async () => {
    const p = new MapPersistence()
    p.saveQueued(mapData('first'))
    // Not yet flushed before debounce elapses.
    let loaded = await p.load()
    expect(loaded).toBeNull()
    await vi.advanceTimersByTimeAsync(500)
    loaded = await p.load()
    expect((loaded?.data as unknown as { nodeData: { topic: string } }).nodeData.topic).toBe('first')
  })

  it('lets the latest queued save win', async () => {
    const p = new MapPersistence()
    p.saveQueued(mapData('one'))
    p.saveQueued(mapData('two'))
    p.saveQueued(mapData('three'))
    await vi.advanceTimersByTimeAsync(500)
    const loaded = await p.load()
    expect((loaded?.data as unknown as { nodeData: { topic: string } }).nodeData.topic).toBe('three')
  })

  it('cancelPending prevents the save', async () => {
    const p = new MapPersistence()
    p.saveQueued(mapData('pending'))
    p.cancelPending()
    await vi.advanceTimersByTimeAsync(500)
    const loaded = await p.load()
    expect(loaded).toBeNull()
  })
})
