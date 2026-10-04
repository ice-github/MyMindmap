// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PREFS,
  loadPreferences,
  resetPreferences,
  savePreferences,
} from '../../src/storage/preferences'

const KEY = 'my-mindmap:prefs:v1'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('preferences', () => {
  it('returns defaults when empty', () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFS)
  })

  it('round-trips through localStorage', () => {
    const next = { ...DEFAULT_PREFS, animationEnabled: false, toolbarVisible: false }
    expect(savePreferences(next)).toBe(true)
    expect(loadPreferences()).toEqual(next)
  })

  it('falls back to defaults on invalid JSON', () => {
    localStorage.setItem(KEY, 'not-json{{{')
    expect(loadPreferences()).toEqual(DEFAULT_PREFS)
  })

  it('sanitizes non-boolean values', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        animationEnabled: 'yes',
        appearEffect: 1,
        flipEnabled: false,
        focusPulse: null,
        unknownKey: true,
      }),
    )
    const loaded = loadPreferences()
    expect(loaded.animationEnabled).toBe(DEFAULT_PREFS.animationEnabled)
    expect(loaded.appearEffect).toBe(DEFAULT_PREFS.appearEffect)
    expect(loaded.flipEnabled).toBe(false)
    expect(loaded.focusPulse).toBe(DEFAULT_PREFS.focusPulse)
  })

  it('returns false when save throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded')
    })
    expect(savePreferences({ ...DEFAULT_PREFS })).toBe(false)
  })

  it('adds the edge effect default to older preferences', () => {
    localStorage.setItem(KEY, JSON.stringify({ appearEffect: true, autoSave: false }))
    expect(loadPreferences().edgeEffect).toBe(true)
    expect(loadPreferences().dimExistingEdges).toBe(true)
    expect(loadPreferences().subnodeBorders).toBe(true)
    expect(loadPreferences().autoSave).toBe(false)
  })

  it('persists disabling the edge effect independently', () => {
    const prefs = { ...DEFAULT_PREFS, edgeEffect: false }
    expect(savePreferences(prefs)).toBe(true)
    expect(loadPreferences()).toEqual(prefs)
  })

  it('reset restores defaults', () => {
    savePreferences({ ...DEFAULT_PREFS, animationEnabled: false })
    const reset = resetPreferences()
    expect(reset).toEqual(DEFAULT_PREFS)
    expect(loadPreferences()).toEqual(DEFAULT_PREFS)
  })

  it('persists the existing-edge dimming choice separately from edge drawing', () => {
    const prefs = { ...DEFAULT_PREFS, dimExistingEdges: false }
    expect(savePreferences(prefs)).toBe(true)
    expect(loadPreferences().dimExistingEdges).toBe(false)
    expect(loadPreferences().edgeEffect).toBe(true)
  })

  it('persists subnode borders independently of editing and animation', () => {
    const prefs = { ...DEFAULT_PREFS, subnodeBorders: false, editable: false, animationEnabled: false }
    expect(savePreferences(prefs)).toBe(true)
    expect(loadPreferences()).toEqual(prefs)
    expect(resetPreferences().subnodeBorders).toBe(true)
  })
})
