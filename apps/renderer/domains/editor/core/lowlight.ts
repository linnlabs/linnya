/**
 * Lowlight 语法高亮实例管理
 * 提供单例模式，确保整个应用使用同一个 lowlight 实例
 */
import { createLowlight } from 'lowlight'
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import bash from 'highlight.js/lib/languages/bash'

let lowlightInstance: ReturnType<typeof createLowlight> | null = null

/**
 * 获取 lowlight 单例实例
 * 首次调用时创建实例并注册语言
 * @returns 配置好的 lowlight 实例
 */
export function getLowlight() {
  if (!lowlightInstance) {
    lowlightInstance = createLowlight()
    lowlightInstance.register({
      js: javascript,
      javascript: javascript,
      python: python,
      py: python,
      css: css,
      html: xml,
      vue: xml,
      bash: bash,
      shell: bash
    })
  }
  return lowlightInstance
}

/**
 * 重置 lowlight 实例（主要用于测试）
 */
export function resetLowlight() {
  lowlightInstance = null
}

