//src/renderer/extensions/plugins/UniqueIdsPlugin.js

/**
 * 确保所有 rootBlock 和相关的 contentBlock (如 headingBlock) 节点都有一个唯一的 ID
 * 
 * 这个插件会检查指定类型的节点，如果它们没有 ID 或者 ID 重复，
 * 就会生成一个新的 ID 并替换旧的 ID。
 * 
 */

import { Extension } from '@tiptap/core'; // <--- 导入 Extension
import { Plugin, PluginKey } from 'prosemirror-state';
import { generateRootBlockId, isValidUUID } from '../../../../shared/utils/idUtils'; // 导入 ID 生成和验证函数
import { NODE_GROUPS } from './schema'; // <--- 导入节点组定义

export const ensureUniqueIdsPluginKey = new PluginKey('ensureUniqueIds');

// --- 将原来的函数逻辑包装进 Extension.create ---
export const UniqueIdsExtension = Extension.create({
  name: 'uniqueIdsExtension', // Tiptap 扩展的名称

  // --- 添加 addProseMirrorPlugins 方法 ---
  addProseMirrorPlugins() {
    // 在这里创建并返回插件实例

    return [ // 必须返回一个数组
      new Plugin({
        key: ensureUniqueIdsPluginKey, // 使用之前定义的 Key
        appendTransaction(transactions, oldState, newState) {
          // --- 优化：只在文档实际改变时才检查 --- 
          const docChanged = transactions.some(tr => tr.docChanged);
          if (!docChanged) {
            return null;
          }

          // pending 注入的块已有后端分配的唯一 ID，无需在注入期间重复检查，
          // 避免 M 次 dispatch × O(N) 全文档扫描的 O(MN) 开销。
          const isPendingApply = transactions.some(tr => tr.getMeta('pendingRevisionApply'));
          if (isPendingApply) {
            return null;
          }

          let fixTr = null;
          const ids = new Set(); // 用于跟踪整个文档中已使用的 ID
          let fixCount = 0;
          const contentBlockTypes = NODE_GROUPS.BLOCK_CONTENT.split('|'); // 获取内容块类型列表

          newState.doc.descendants((node, pos, parent) => {
            let nodeTypeToCheck = null;
            
            // 检查是否为 rootBlock
            if (node.type.name === 'rootBlock') {
              nodeTypeToCheck = 'rootBlock';
            }
            // 检查是否为需要检查 ID 的 contentBlock
            else if (contentBlockTypes.includes(node.type.name) && node.attrs.id !== undefined) {
              // 只有定义了 id 属性的 contentBlock 才需要检查
              // 例如：headingBlock 通常有 id, baseBlock 可能没有
              nodeTypeToCheck = node.type.name; 
            }

            // 如果是需要检查的类型
            if (nodeTypeToCheck) {
              let needsFix = false;
              let reason = '';
              const currentId = node.attrs.id;

              if (!currentId || !isValidUUID(currentId)) {
                needsFix = true;
                reason = `Invalid or missing ID`;
              } else if (ids.has(currentId)) {
                needsFix = true;
                reason = `Duplicate ID`;
              }

              if (needsFix) {
                fixCount++;
                // 使用通用的 UUID 生成函数
                const newId = generateRootBlockId(); // 假设这个函数生成通用 UUID
                
                if (!fixTr) {
                  fixTr = newState.tr;
                }

                try {
                  // 更新节点属性，只修改 id
                  fixTr.setNodeMarkup(pos, null, { ...node.attrs, id: newId });
                  ids.add(newId); // 将 *新* ID 加入集合
                } catch (e) {
                  console.error(`[EnsureUniqueIdsPlugin] setNodeMarkup failed for ${nodeTypeToCheck} at pos ${pos}:`, e);
                }
              } else {
                ids.add(currentId); // 将 *有效且唯一* 的 ID 加入集合
              }
              
              // --- 关键修改：如果是 rootBlock，继续深入；如果是 contentBlock，则停止 --- 
              return node.type.name === 'rootBlock'; 
            }
            
            // 对于其他类型的节点，默认继续遍历子节点 (除非有特定理由停止)
            return true;
          });

          return fixTr;
        },
      })
    ];
  },
});

// --- 修改默认导出 ---
export default UniqueIdsExtension;
