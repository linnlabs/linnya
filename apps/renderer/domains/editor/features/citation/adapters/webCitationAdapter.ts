/**
 * @file citation/adapters/webCitationAdapter.ts
 * @description Web/Manual 表单 -> CitationNodeAttrs 映射适配器（Phase 2）
 *
 * 职责：
 * - 将 Web/Manual 表单数据转换为 CitationNode 所需的 attrs 结构
 * - 处理 Web 与 Manual 两种来源类型
 * - 保持类型安全
 */

import type { CitationNodeAttrs, CitationSourceType } from '../types'
import type { CitationWebManualValidationErrorCode } from '../functions/citationPresentation'

/**
 * Web/Manual 表单输入数据
 */
export interface WebManualFormInput {
  /** URL（web 来源时必填） */
  url: string
  /** 标题（必填） */
  title: string
  /** 作者（逗号分隔字符串，可选） */
  authors: string
  /** 年份/日期（可选） */
  date: string
  /** 容器标题（可选） */
  containerTitle: string
  /** 引用片段（可选） */
  snippet: string
  /** 是否是手动来源（无 URL） */
  isManual: boolean
}

/**
 * 将 Web/Manual 表单转换为 CitationNodeAttrs
 *
 * @param form 表单数据
 * @returns CitationNodeAttrs（不含 citationId，由 CitationNode 自动生成）
 */
export function convertWebManualFormToCitationAttrs(
  form: WebManualFormInput
): Omit<CitationNodeAttrs, 'citationId'> {
  // 确定来源类型
  const sourceType: CitationSourceType = form.isManual ? 'manual' : 'web'

  // 确定 sourceId
  // - Web: 使用 URL
  // - Manual: 生成 UUID
  const sourceId = form.isManual ? crypto.randomUUID() : form.url.trim()

  // 解析作者列表（逗号分隔）
  const authors = form.authors.trim()
    ? form.authors
        .split(',')
        .map(a => a.trim())
        .filter(Boolean)
    : undefined

  return {
    sourceType,
    sourceId,
    title: form.title.trim(),
    snippet: form.snippet.trim() || '',
    // 预留字段
    authors: authors && authors.length > 0 ? authors : undefined,
    date: form.date.trim() || undefined,
    url: form.isManual ? undefined : form.url.trim() || undefined,
    containerTitle: form.containerTitle.trim() || undefined,
  }
}

/**
 * 校验 Web/Manual 表单
 *
 * @param form 表单数据
 * @returns 错误信息（字段名 -> 错误消息），空对象表示校验通过
 */
export function validateWebManualForm(
  form: WebManualFormInput
): Partial<Record<keyof WebManualFormInput, CitationWebManualValidationErrorCode>> {
  const errors: Partial<Record<keyof WebManualFormInput, CitationWebManualValidationErrorCode>> = {}

  // 标题必填
  if (!form.title.trim()) {
    errors.title = 'titleRequired'
  }

  // Web 来源时 URL 必填
  if (!form.isManual && !form.url.trim()) {
    errors.url = 'urlRequired'
  }

  // URL 格式校验（简单校验）
  if (!form.isManual && form.url.trim()) {
    try {
      new URL(form.url.trim())
    } catch {
      errors.url = 'urlInvalid'
    }
  }

  return errors
}

/**
 * 导出适配器对象（便于后续扩展）
 */
export const webCitationAdapter = {
  convertWebManualFormToCitationAttrs,
  validateWebManualForm,
}
