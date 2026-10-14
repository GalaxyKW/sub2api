import { describe, expect, it } from 'vitest'
import { hasWebImageConfiguration, isFreeWebImageAccount, isOpenAIImageTestModel, readWebImageSettings, resolveWebImageAlias, webImageModelOptions } from '../webImageBridge'
import type { Account } from '@/types'

const free = { platform: 'openai', type: 'oauth', parent_account_id: null, credentials: { plan_type: ' Free ' } } as Account

describe('Free web image configuration', () => {
  it('only accepts known Free OAuth parent accounts', () => {
    expect(isFreeWebImageAccount(free)).toBe(true)
    for (const change of [{ type: 'apikey' }, { platform: 'anthropic' }, { parent_account_id: 1 }, { credentials: { plan_type: 'pro' } }, { credentials: {} }]) {
      expect(isFreeWebImageAccount({ ...free, ...change } as Account)).toBe(false)
    }
  })

  it('distinguishes explicit boolean configuration from a missing or malformed flag', () => {
    expect(hasWebImageConfiguration()).toBe(false)
    expect(hasWebImageConfiguration({})).toBe(false)
    expect(hasWebImageConfiguration({ chatgpt_web_image_enabled: 'true' })).toBe(false)
    expect(hasWebImageConfiguration({ chatgpt_web_image_enabled: true })).toBe(true)
    expect(hasWebImageConfiguration({ chatgpt_web_image_enabled: false })).toBe(true)
  })

  it('keeps absent settings disabled and uses the legacy default image entry', () => {
    expect(readWebImageSettings()).toEqual({ enabled: false, regularChat: false, markdownPreview: true, defaultModel: 'gpt-image-2' })
    expect(readWebImageSettings({ chatgpt_web_image_enabled: false, chatgpt_web_image_regular_chat: true, chatgpt_web_image_markdown_preview: false, chatgpt_web_image_default_model: ' custom-image ' })).toEqual({ enabled: false, regularChat: true, markdownPreview: false, defaultModel: 'custom-image' })
  })

  it('requires explicit image authorization and exposes permitted aliases', () => {
    expect(webImageModelOptions({})).toEqual([])
    expect(webImageModelOptions(undefined)).toEqual([])
    expect(webImageModelOptions({ 'gpt-6-luna': 'gpt-6-luna', illustration: 'gpt-image-2.5-flare' })).toEqual(['illustration'])
  })

  it('uses the mapped target when choosing image versus text account tests', () => {
    expect(isOpenAIImageTestModel({}, 'gpt-image-2')).toBe(true)
    expect(isOpenAIImageTestModel({ picture: 'gpt-image-2' }, 'picture')).toBe(true)
    expect(isOpenAIImageTestModel({ 'gpt-image-custom': 'gpt-5.1' }, 'gpt-image-custom')).toBe(false)
    expect(isOpenAIImageTestModel({ 'gpt-image-*': 'gpt-5.1' }, 'gpt-image-custom')).toBe(false)
    expect(isOpenAIImageTestModel({ '*': 'gpt-image-2', 'gpt-image-custom': 'gpt-5.1' }, 'gpt-image-custom')).toBe(false)
  })

  it('resolves exact mappings before the longest trailing wildcard', () => {
    const mapping = { '*': 'gpt-image-1', 'gpt-image-*': 'gpt-image-2', 'gpt-image-2.5-*': 'gpt-image-2.5-flare', 'gpt-image-2': 'gpt-6-luna' }
    expect(resolveWebImageAlias(mapping, 'gpt-image-2')).toBeNull()
    expect(resolveWebImageAlias(mapping, 'gpt-image-2.5-sunburst')).toBe('gpt-image-2.5-flare')
    expect(resolveWebImageAlias(mapping, 'gpt-image-1.5')).toBe('gpt-image-2')
    expect(webImageModelOptions(mapping)).toContain('gpt-image-2.5-sunburst')
    expect(webImageModelOptions(mapping)).not.toContain('gpt-image-2')
  })
})
