/**
 * @file codeBlockLanguage.ts
 * @description 代码块语言的入口规整：保留给图表的围栏语言不能成为普通代码块的语言。
 *
 * 持久化不允许存在“专属语言的普通代码”。HTML 粘贴、输入规则等入口把它规整为 `json`
 * （图表规格本来就是 JSON），人类仍然可以看到并修复这段内容；不会静默丢弃。
 */

import { isMarkdownChartFenceLanguage } from '@app/schemas'

/** 无法作为普通代码保存的保留语言，统一落到 `json`。 */
export const RESERVED_CODE_LANGUAGE_FALLBACK = 'json'

export function normalizeCodeBlockLanguage(language: string | null | undefined): string | null {
  if (language === null || language === undefined || language === '') return null
  return isMarkdownChartFenceLanguage(language) ? RESERVED_CODE_LANGUAGE_FALLBACK : language
}
