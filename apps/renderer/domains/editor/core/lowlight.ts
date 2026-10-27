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
import plaintext from 'highlight.js/lib/languages/plaintext'
import typescript from 'highlight.js/lib/languages/typescript'
import json from 'highlight.js/lib/languages/json'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import php from 'highlight.js/lib/languages/php'
import ruby from 'highlight.js/lib/languages/ruby'
import swift from 'highlight.js/lib/languages/swift'
import kotlin from 'highlight.js/lib/languages/kotlin'
import scala from 'highlight.js/lib/languages/scala'
import yaml from 'highlight.js/lib/languages/yaml'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import powershell from 'highlight.js/lib/languages/powershell'
import r from 'highlight.js/lib/languages/r'
import markdown from 'highlight.js/lib/languages/markdown'
import diff from 'highlight.js/lib/languages/diff'
import c from 'highlight.js/lib/languages/c'

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
      shell: bash, plaintext,
      // 所有消费者使用同一份注册表，不能依赖对话组件先挂载才获得脚本/配置文件高亮。
      typescript, ts: typescript, json, xml, sql, java, c, cpp, csharp, go, rust,
      swift, kotlin, scala, php, ruby, r, powershell, yaml, markdown, dockerfile, diff,
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

