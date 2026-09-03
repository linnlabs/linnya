/**
 * blockId → pos 索引
 *
 * 维护一个以 ProseMirror 不可变 doc 为 key 的 WeakMap 缓存。
 * 首次访问时做一次 O(N) 的 doc.descendants 遍历（只到 rootBlock 层，不进入块内容），
 * 同一 doc 的后续访问 O(1) 命中缓存。
 * 编辑产生新 doc 引用后，旧 doc 会被 GC，缓存自动失效。
 *
 * 设计初衷：
 * 编辑器中大量场景需要"按 blockId 查 pos"（Revision 注入、批注排序、光标定位等），
 * 之前各消费方各自做 doc.descendants 全遍历，对大文档（100+ 块）造成 O(N²) 级别重复扫描。
 * 本模块将"全文档 rootBlock 位置表"统一缓存，所有消费方共享同一份索引。
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

const indexCache = new WeakMap<ProseMirrorNode, Map<string, number>>()

/**
 * 构建 blockId → pos 映射
 * 只遍历到 rootBlock 层级，跳过块内容以降低常数因子。
 */
function buildBlockPosIndex(doc: ProseMirrorNode): Map<string, number> {
  const index = new Map<string, number>()
  doc.descendants((node, pos) => {
    if (node.type.name === 'rootBlock') {
      const id = node.attrs.id
      if (typeof id === 'string' && id.length > 0) {
        index.set(id, pos)
      }
      return false
    }
  })
  return index
}

/**
 * 获取当前 doc 对应的 blockId → pos 索引（带缓存）
 *
 * @param doc - ProseMirror 文档节点（不可变）
 * @returns blockId 到文档位置的映射
 */
export function getBlockPosIndex(doc: ProseMirrorNode): Map<string, number> {
  let index = indexCache.get(doc)
  if (!index) {
    index = buildBlockPosIndex(doc)
    indexCache.set(doc, index)
  }
  return index
}
