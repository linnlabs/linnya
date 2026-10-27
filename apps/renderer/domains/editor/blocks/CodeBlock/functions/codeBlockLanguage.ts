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

const FILE_LANGUAGES: Readonly<Record<string, string>> = {
  md: 'markdown', markdown: 'markdown', txt: 'plaintext',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', json: 'json', yaml: 'yaml', yml: 'yaml',
  py: 'python', sh: 'bash', bash: 'bash', ps1: 'powershell', css: 'css',
  html: 'html', xml: 'xml', vue: 'vue', sql: 'sql', rs: 'rust', go: 'go',
};

/** 独立文件的高亮语言由后缀决定；未知后缀按原文显示，不做语言猜测。 */
export function resolveCodeFileLanguage(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return FILE_LANGUAGES[extension] ?? 'plaintext';
}
