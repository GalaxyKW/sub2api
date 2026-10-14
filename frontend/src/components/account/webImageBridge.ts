import type { Account } from '@/types'

export const DEFAULT_WEB_IMAGE_MODEL = 'gpt-image-2'
export const WEB_IMAGE_MODELS = [
  'gpt-image-1', 'gpt-image-1.5', 'gpt-image-2',
  'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'
]

export function isFreeWebImageAccount(account: Account | null | undefined): boolean {
  return account?.platform === 'openai' && account.type === 'oauth' &&
    account.parent_account_id == null &&
    String(account.credentials?.plan_type ?? '').trim().toLowerCase() === 'free'
}

export function readWebImageSettings(extra?: Record<string, unknown>) {
  return {
    enabled: extra?.chatgpt_web_image_enabled === true,
    regularChat: extra?.chatgpt_web_image_regular_chat === true,
    markdownPreview: extra?.chatgpt_web_image_markdown_preview !== false,
    defaultModel: typeof extra?.chatgpt_web_image_default_model === 'string' && extra.chatgpt_web_image_default_model.trim()
      ? extra.chatgpt_web_image_default_model.trim()
      : DEFAULT_WEB_IMAGE_MODEL
  }
}

// Web images require explicit authorization even when an empty text-model
// mapping otherwise means unrestricted. Prefer exact mappings, then the
// longest trailing-star match, matching the account resolver on the server.
export function resolveWebImageAlias(mapping: unknown, publicID: string): string | null {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return null
  const entries = Object.entries(mapping).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  const exact = entries.find(([name]) => name === publicID)
  const found = exact ?? entries
    .filter(([name]) => name.endsWith('*') && publicID.startsWith(name.slice(0, -1)))
    .sort(([left], [right]) => right.length - left.length)[0]
  const target = found?.[1]?.trim()
  return target?.toLowerCase().startsWith('gpt-image-') ? target : null
}

export function webImageModelOptions(mapping: unknown, defaultModel = DEFAULT_WEB_IMAGE_MODEL): string[] {
  const named = mapping && typeof mapping === 'object' && !Array.isArray(mapping)
    ? Object.keys(mapping).filter(name => !name.includes('*'))
    : []
  return [...new Set([...WEB_IMAGE_MODELS, defaultModel, ...named])]
    .filter(name => Boolean(name) && resolveWebImageAlias(mapping, name) !== null)
}
