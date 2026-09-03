/**
 * @file citation/extension/CitationFeatureExtension.ts
 * @description Citation 功能扩展 - 负责 bibliography 的自动维护
 *
 * 本扩展通过 appendTransaction 实现：
 * - 文档内插入 CitationNode 后：文末自动出现唯一的 bibliographyBlock
 * - 删除文档内所有 CitationNode 后：bibliographyBlock 自动移除
 * - 保证 bibliography 始终满足：文末 + 最多一个
 *
 * 性能策略（Phase 1 简化版）：
 * - 在 docChanged 时执行检查
 * - 使用 meta 标记避免无限循环
 * - 后续 Phase 可以优化为增量检测 + 节流
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, Transaction } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import {
  scanDocForCitations,
  computeBibliographyFixActions,
  createBibliographyBlockJSON,
  debugLog,
} from '../plugins/bibliographyAutoMaintain'
import { citationRenderPluginKey } from '../render/citationRenderPlugin'
import { markCitationDerivationTransaction } from '../../../core/transactions/editorTransactionMeta'

// Plugin Key，用于标识此插件
export const citationAutoMaintainPluginKey = new PluginKey('citationAutoMaintain')

// Meta Key，用于标记由此插件生成的 transaction，避免循环
const CITATION_AUTO_META = 'citation-bibliography-auto'

/**
 * CitationFeatureExtension
 *
 * 负责 bibliography 的自动维护逻辑。
 * 参考 UniqueIdsExtension 的实现模式。
 */
export const CitationFeatureExtension = Extension.create({
  name: 'citationFeature',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: citationAutoMaintainPluginKey,

        /**
         * appendTransaction：在每批 transaction 后检查并修正文档结构
         */
        appendTransaction(
          transactions: readonly Transaction[],
          oldState: EditorState,
          newState: EditorState
        ): Transaction | null {
          // 1. 检查是否有文档变更
          const hasDocChanged = transactions.some(tr => tr.docChanged)
          const isForceDerivation = transactions.some(tr => tr.getMeta('forceCitationDerivation'))
          const isDocumentLoadProjection = transactions.some(tr =>
            tr.getMeta('documentLoadProjection')
          )
          if (!hasDocChanged && !isForceDerivation && !isDocumentLoadProjection) {
            return null
          }

          // pending 注入期间跳过 bibliography 维护，注入完成后由后续 transaction 自然触发
          if (transactions.some(tr => tr.getMeta('pendingRevisionApply'))) {
            return null
          }

          // 2. 检查是否是我们自己触发的 transaction（避免循环）
          const isSelfTriggered = transactions.some(tr => tr.getMeta(CITATION_AUTO_META) === true)
          if (isSelfTriggered) {
            return null
          }

          // 3. 前置检查：利用 citationRenderPlugin 已计算的派生结果
          // 如果变更前后文档中都没有 citation 实例，无需执行全文档扫描
          const oldRenderState = citationRenderPluginKey.getState(oldState)
          const newRenderState = citationRenderPluginKey.getState(newState)
          if (
            !isDocumentLoadProjection &&
            oldRenderState &&
            newRenderState &&
            oldRenderState.derivation.instances.length === 0 &&
            newRenderState.derivation.instances.length === 0
          ) {
            return null
          }

          // 4. 扫描文档
          const scanResult = scanDocForCitations(newState.doc)
          debugLog('扫描结果:', scanResult)

          // 4. 计算修正动作
          const fixResult = computeBibliographyFixActions(scanResult)
          debugLog('修正动作:', fixResult)

          // 5. 如果不需要修正，返回 null
          if (!fixResult.needsFix) {
            return null
          }

          // 6. 构造修正 transaction
          let fixTr = newState.tr
          fixTr.setMeta(CITATION_AUTO_META, true)
          markCitationDerivationTransaction(fixTr)

          // 按顺序执行修正动作
          // 注意：多个动作时需要考虑位置偏移，这里 Phase 1 简化处理
          for (const action of fixResult.actions) {
            switch (action.type) {
              case 'remove': {
                // 移除所有 bibliography（从后往前删除，避免位置偏移问题）
                const sortedPositions = [...action.positions].sort((a, b) => b - a)
                for (const pos of sortedPositions) {
                  const node = fixTr.doc.nodeAt(pos)
                  if (node && node.type.name === 'rootBlock') {
                    // 检查内容是否是 bibliographyBlock
                    if (node.firstChild?.type.name === 'bibliographyBlock') {
                      fixTr.delete(pos, pos + node.nodeSize)
                      debugLog('删除 bibliography at pos:', pos)
                    }
                  }
                }
                break
              }

              case 'create': {
                // 在文末创建 bibliography
                const bibliographyJSON = createBibliographyBlockJSON('numeric')
                fixTr.insert(fixTr.doc.content.size, newState.schema.nodeFromJSON(bibliographyJSON))
                debugLog('创建 bibliography at end')
                break
              }

              case 'cleanup_duplicates': {
                // 清理多余的 bibliography（从后往前删除，保留 keepPos）
                const sortedRemovePositions = [...action.removePositions].sort((a, b) => b - a)
                for (const pos of sortedRemovePositions) {
                  const node = fixTr.doc.nodeAt(pos)
                  if (node && node.type.name === 'rootBlock') {
                    if (node.firstChild?.type.name === 'bibliographyBlock') {
                      fixTr.delete(pos, pos + node.nodeSize)
                      debugLog('清理重复 bibliography at pos:', pos)
                    }
                  }
                }
                // 注意：清理后可能还需要移动到文末，但那会在下一次 appendTransaction 中处理
                break
              }

              case 'move_to_end': {
                // 移动 bibliography 到文末
                // 策略：先删除原位置的节点，再在文末插入
                const node = fixTr.doc.nodeAt(action.fromPos)
                if (node && node.type.name === 'rootBlock') {
                  if (node.firstChild?.type.name === 'bibliographyBlock') {
                    // 保存节点 JSON
                    const nodeJSON = node.toJSON()
                    // 删除原位置
                    fixTr.delete(action.fromPos, action.fromPos + node.nodeSize)
                    // 在文末插入
                    fixTr.insert(fixTr.doc.content.size, newState.schema.nodeFromJSON(nodeJSON))
                    debugLog('移动 bibliography 到文末')
                  }
                }
                break
              }

              case 'none':
              default:
                // 无需操作
                break
            }
          }

          // 7. 检查 transaction 是否有实际变更
          if (fixTr.docChanged) {
            debugLog('应用修正 transaction')
            return fixTr
          }

          return null
        },
      }),
    ]
  },
})

export default CitationFeatureExtension
