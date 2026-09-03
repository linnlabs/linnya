/**
 * MindMap 工程守卫（guards）
 *
 * 中文说明：
 * - 目标：把 docs 契约落地为“可执行的工程约束”
 * - 失败即退出（exitCode=1），用于 CI / pre-commit / 本地自检
 *
 * 守卫内容：
 * 1) 禁止散落 `linkDiv()` / `layout()` 调用（白名单文件除外）
 * 2) 禁止 domId（me 前缀）相关的手写拼接/解析（白名单文件除外）
 * 3) 限制 `dataset.nodeid` 的读取/写入点位（避免 domId 泄漏到跨层接口）
 * 4) 禁止入口文件中出现直连 node ops（命令系统落地后必须为 0）
 *
 * 约束来源：
 * - `packages/plugins/mindmap/src/renderer/docs/contracts.md`
 */

import fs from 'node:fs'
import path from 'node:path'

type Violation = {
  ruleId: string
  file: string
  line: number
  preview: string
}

const repoRoot = process.cwd()
const mindmapRoot = path.join(repoRoot, 'packages/plugins/mindmap/src/renderer')
const ENTRYPOINT_FILES = new Set([
  'packages/plugins/mindmap/src/renderer/shared/hotkeys/defaultHotkeys.ts',
  'packages/plugins/mindmap/src/renderer/interaction/handlers/click.ts',
  'packages/plugins/mindmap/src/renderer/presentation/ui/MindMapContextMenu.vue',
  'packages/plugins/mindmap/src/renderer/ui/MindMapContextMenu.vue',
])

// 中文说明：
// - Phase 2 后，业务快捷键只能通过 KeymapRegistry 注册
// - 仍允许少量历史遗留/局部场景使用 keydown 监听（需白名单）
const KEYDOWN_LISTENER_WHITELIST = new Set([
  'packages/plugins/mindmap/src/renderer/interaction/keyboard/installMindMapKeymap.ts',
  'packages/plugins/mindmap/src/renderer/shared/plugin/keypress.ts',
  'packages/plugins/mindmap/src/renderer/shared/hotkeys/defaultHotkeys.ts',
  'packages/plugins/mindmap/src/renderer/shared/utils/svg/index.ts',
  'packages/plugins/mindmap/src/renderer/features/evidence/ui/ReferenceInsertPanel.vue',
])

const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist_build',
  'temp',
  'temp_ts_build',
  'temp_tsup',
  'build',
  'extraResources',
])

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath)
  return ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue'].includes(ext)
}

function walk(dir: string, out: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      // 允许 `.cursor` 等隐藏目录不扫描（降低噪声）
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue
      walk(full, out)
    } else if (entry.isFile()) {
      if (isTextFile(full)) out.push(full)
    }
  }
}

function readLines(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf8')
  return raw.split(/\r?\n/)
}

function rel(p: string): string {
  return path.relative(repoRoot, p).replaceAll('\\', '/')
}

function isInDocs(filePath: string): boolean {
  return rel(filePath).includes('packages/plugins/mindmap/src/renderer/docs/')
}

function isWhitelistedLinkDivFile(filePath: string): boolean {
  const r = rel(filePath)
  return (
    isInDocs(filePath) ||
    r === 'packages/plugins/mindmap/src/renderer/shared/utils/reflow/ReflowScheduler.ts' ||
    r === 'packages/plugins/mindmap/src/renderer/presentation/render/links.ts'
  )
}

function isWhitelistedLayoutFile(filePath: string): boolean {
  const r = rel(filePath)
  // 中文说明：layout 属于“结构重建”内核能力，允许出现在极少数白名单点位
  return (
    isInDocs(filePath) ||
    r === 'packages/plugins/mindmap/src/renderer/domain/core/methods.ts' ||
    r === 'packages/plugins/mindmap/src/renderer/interaction/dataControls.ts'
  )
}

function isWhitelistedMePrefixFile(filePath: string): boolean {
  const r = rel(filePath)
  return (
    isInDocs(filePath) ||
    r === 'packages/plugins/mindmap/src/renderer/shared/utils/dom/nodeId.ts'
  )
}

function isWhitelistedDatasetNodeidFile(filePath: string): boolean {
  const r = rel(filePath)
  return (
    isInDocs(filePath) ||
    r === 'packages/plugins/mindmap/src/renderer/shared/utils/dom/nodeId.ts' ||
    r === 'packages/plugins/mindmap/src/renderer/shared/utils/dom/index.ts' ||
    r === 'packages/plugins/mindmap/src/renderer/presentation/ui/NodeAddonsHost.vue'
  )
}

function isEntryPointFile(filePath: string): boolean {
  return ENTRYPOINT_FILES.has(rel(filePath))
}

function isWhitelistedKeydownListenerFile(filePath: string): boolean {
  return KEYDOWN_LISTENER_WHITELIST.has(rel(filePath))
}

function isIntentPayloadFile(filePath: string): boolean {
  const r = rel(filePath)
  return r === 'packages/plugins/mindmap/src/renderer/interaction/intents/types.ts'
}

function collectViolations(): Violation[] {
  const files: string[] = []
  walk(mindmapRoot, files)

  const violations: Violation[] = []

  for (const file of files) {
    const lines = readLines(file)
    // 中文说明：简单的块注释跟踪，避免把文档/注释中的示例代码误判成真实调用
    let inBlockComment = false

    // Rule 1: linkDiv 直接调用 guard（白名单除外）
    if (!isWhitelistedLinkDivFile(file)) {
      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i]
        const trimmed = rawLine.trim()
        // 处理块注释进入/退出
        if (inBlockComment) {
          if (trimmed.includes('*/')) inBlockComment = false
          continue
        }
        if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
          if (!trimmed.includes('*/')) inBlockComment = true
          continue
        }
        if (trimmed.startsWith('*')) continue
        if (trimmed.startsWith('//')) continue
        const line = rawLine.replace(/\/\/.*$/, '')
        if (/\bthis\.linkDiv\s*\(/.test(line) || /\b\.linkDiv\s*\(/.test(line)) {
          violations.push({
            ruleId: 'MM-GUARD-01-no-direct-linkDiv-layout',
            file: rel(file),
            line: i + 1,
            preview: trimmed,
          })
        }
      }
    }

    // Rule 1b: layout 直接调用 guard（白名单除外）
    if (!isWhitelistedLayoutFile(file)) {
      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i]
        const trimmed = rawLine.trim()
        // 处理块注释进入/退出
        if (inBlockComment) {
          if (trimmed.includes('*/')) inBlockComment = false
          continue
        }
        if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
          if (!trimmed.includes('*/')) inBlockComment = true
          continue
        }
        if (trimmed.startsWith('*')) continue
        if (trimmed.startsWith('//')) continue
        const line = rawLine.replace(/\/\/.*$/, '')
        if (/\bthis\.layout\s*\(/.test(line) || /\b\.layout\s*\(/.test(line)) {
          violations.push({
            ruleId: 'MM-GUARD-01b-no-direct-layout-outside-core',
            file: rel(file),
            line: i + 1,
            preview: trimmed,
          })
        }
      }
    }

    // Rule 2: 禁止手写 me 前缀拼接/解析（白名单除外）
    if (!isWhitelistedMePrefixFile(file)) {
      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i]
        const trimmed = rawLine.trim()
        // 处理块注释进入/退出
        if (inBlockComment) {
          if (trimmed.includes('*/')) inBlockComment = false
          continue
        }
        if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
          if (!trimmed.includes('*/')) inBlockComment = true
          continue
        }
        if (trimmed.startsWith('*')) continue
        if (trimmed.startsWith('//')) continue
        const line = rawLine.replace(/\/\/.*$/, '')
        if (/'me'\s*\+/.test(line) || /startsWith\(\s*['"]me['"]\s*\)/.test(line) || /slice\(\s*2\s*\)/.test(line)) {
          violations.push({
            ruleId: 'MM-GUARD-02-no-handwritten-me-prefix',
            file: rel(file),
            line: i + 1,
            preview: trimmed,
          })
        }
      }
    }

    // Rule 3: 限制 dataset.nodeid 的出现位置（避免 domId 泄漏）
    if (!isWhitelistedDatasetNodeidFile(file)) {
      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i]
        const trimmed = rawLine.trim()
        // 处理块注释进入/退出
        if (inBlockComment) {
          if (trimmed.includes('*/')) inBlockComment = false
          continue
        }
        if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
          if (!trimmed.includes('*/')) inBlockComment = true
          continue
        }
        if (trimmed.startsWith('*')) continue
        if (trimmed.startsWith('//')) continue
        const line = rawLine.replace(/\/\/.*$/, '')
        if (/dataset\.nodeid/.test(line)) {
          violations.push({
            ruleId: 'MM-GUARD-03-restrict-dataset-nodeid',
            file: rel(file),
            line: i + 1,
            preview: trimmed,
          })
        }
      }
    }

    // Rule 4: 禁止 nodeId 字段携带 domId（显式 me 前缀）
    if (!isInDocs(file)) {
      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i]
        const trimmed = rawLine.trim()
        // 处理块注释进入/退出
        if (inBlockComment) {
          if (trimmed.includes('*/')) inBlockComment = false
          continue
        }
        if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
          if (!trimmed.includes('*/')) inBlockComment = true
          continue
        }
        if (trimmed.startsWith('*')) continue
        if (trimmed.startsWith('//')) continue
        const line = rawLine.replace(/\/\/.*$/, '')
        if (/nodeId\s*:\s*['"`]me/.test(line)) {
          violations.push({
            ruleId: 'MM-GUARD-04-no-domId-in-nodeId-field',
            file: rel(file),
            line: i + 1,
            preview: trimmed,
          })
        }
      }
    }

    // Rule 5: 入口文件禁止直连 node ops（命令系统落地后必须为 0）
    if (isEntryPointFile(file)) {
      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i]
        const trimmed = rawLine.trim()
        // 处理块注释进入/退出
        if (inBlockComment) {
          if (trimmed.includes('*/')) inBlockComment = false
          continue
        }
        if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
          if (!trimmed.includes('*/')) inBlockComment = true
          continue
        }
        if (trimmed.startsWith('*')) continue
        if (trimmed.startsWith('//')) continue

        const line = rawLine.replace(/\/\/.*$/, '')

        const directOps = [
          { name: 'removeNodes', pattern: /\b\.removeNodes\s*\(/, allowCommandApi: false },
          { name: 'addChild', pattern: /\b\.addChild\s*\(/, allowCommandApi: true },
          { name: 'insertSibling', pattern: /\b\.insertSibling\s*\(/, allowCommandApi: false },
          { name: 'insertParent', pattern: /\b\.insertParent\s*\(/, allowCommandApi: true },
          { name: 'expandNode', pattern: /\b\.expandNode\s*\(/, allowCommandApi: false },
        ]

        for (const op of directOps) {
          if (!op.pattern.test(line)) continue
          if (op.allowCommandApi) {
            // 中文说明：命令 API 允许出现（如 commands.node.addChild）
            if (line.includes(`commands.node.${op.name}`)) continue
          }
          violations.push({
            ruleId: 'MM-GUARD-05-no-direct-ops-in-entrypoints',
            file: rel(file),
            line: i + 1,
            preview: trimmed,
          })
          break
        }
      }
    }

    // Rule 6: 禁止在非白名单文件中直接 addEventListener('keydown')
    if (!isWhitelistedKeydownListenerFile(file)) {
      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i]
        const trimmed = rawLine.trim()
        // 处理块注释进入/退出
        if (inBlockComment) {
          if (trimmed.includes('*/')) inBlockComment = false
          continue
        }
        if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
          if (!trimmed.includes('*/')) inBlockComment = true
          continue
        }
        if (trimmed.startsWith('*')) continue
        if (trimmed.startsWith('//')) continue
        const line = rawLine.replace(/\/\/.*$/, '')
        if (/addEventListener\s*\(\s*['"]keydown['"]/.test(line)) {
          violations.push({
            ruleId: 'MM-GUARD-06-no-direct-keydown-listener',
            file: rel(file),
            line: i + 1,
            preview: trimmed,
          })
        }
      }
    }

    // Rule 7: Intent payload 禁止 DOM/Event 泄漏（仅检查 payload 定义文件）
    if (isIntentPayloadFile(file)) {
      const forbiddenPayloadTypes = [
        'MouseEvent',
        'PointerEvent',
        'WheelEvent',
        'KeyboardEvent',
        'HTMLElement',
        'Element',
        'Topic',
        'CustomSvg',
        'SummarySvgGroup',
        'Expander',
      ]
      let inPayloadInterface = false
      let braceDepth = 0
      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i]
        const trimmed = rawLine.trim()
        // 处理块注释进入/退出
        if (inBlockComment) {
          if (trimmed.includes('*/')) inBlockComment = false
          continue
        }
        if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
          if (!trimmed.includes('*/')) inBlockComment = true
          continue
        }
        if (trimmed.startsWith('*')) continue
        if (trimmed.startsWith('//')) continue

        if (/^export\s+interface\s+.*Payloads\b/.test(trimmed)) {
          inPayloadInterface = true
          braceDepth = 0
        }
        if (inPayloadInterface) {
          const openCount = (rawLine.match(/{/g) ?? []).length
          const closeCount = (rawLine.match(/}/g) ?? []).length
          braceDepth += openCount - closeCount
          for (const typeName of forbiddenPayloadTypes) {
            if (rawLine.includes(typeName)) {
              violations.push({
                ruleId: 'MM-GUARD-07-no-dom-event-in-intent-payload',
                file: rel(file),
                line: i + 1,
                preview: trimmed,
              })
              break
            }
          }
          if (braceDepth <= 0) {
            inPayloadInterface = false
          }
        }
      }
    }
  }

  return violations
}

function main(): void {
  if (!fs.existsSync(mindmapRoot)) {
    console.error('[mindmap-guards] mindmap root not found:', mindmapRoot)
    process.exit(2)
  }

  const violations = collectViolations()
  if (violations.length === 0) {
    console.log('[mindmap-guards] OK: no violations')
    return
  }

  console.error(`[mindmap-guards] FAILED: ${violations.length} violation(s)`)
  for (const v of violations) {
    console.error(`- ${v.ruleId} ${v.file}:${v.line}`)
    console.error(`  ${v.preview}`)
  }
  process.exitCode = 1
}

main()
