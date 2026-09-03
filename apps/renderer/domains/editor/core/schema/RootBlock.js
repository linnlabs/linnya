// src/renderer/extensions/RootBlock.js

import { Node, mergeAttributes } from '@tiptap/core'
import { NODE_GROUPS, applySchemaToNode } from '../../extensions/core/schema'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import BlockView from '../../ui/BlockView.vue'
import { generateRootBlockId } from '../../../../shared/utils/idUtils'
import {
  getFlag,
  shouldUseRootBlockShellForOwner,
  shouldUseVirtualRootBlockRenderingForOwner,
} from '../../ui/services/editorFeatureFlags'
import { incrementNodeViewCount } from '../../ui/services/editorOpenPerf'
import { createRootBlockShellView } from './RootBlockShellView'
import { createPlaceholderShellView } from '../../features/RenderVirtualization/view/PlaceholderShellView'
import { createRootBlockDomNodeView } from '../../features/RenderVirtualization/view/RootBlockDomNodeView'
import { resolveRootBlockRenderMode } from '../../features/RenderVirtualization/view/resolveRootBlockRenderMode'
import { getRenderVirtualizationBlockHeight } from '../../features/RenderVirtualization/state/blockHeightCacheRegistry'
import {
  ROOT_BLOCK_DOM_ATTRS,
  ROOT_BLOCK_DOM_CLASSES,
  ROOT_BLOCK_DOM_NODE_TYPES,
  ROOT_BLOCK_DOM_RENDER_MODES,
} from '../../shared/rootBlockDomContract'
import { resolveCurrentEditorMessage } from '../../functions/resolveCurrentEditorMessage'

const ROOT_BLOCK_PARSE_SELECTOR = `div.${ROOT_BLOCK_DOM_CLASSES.outer}[${ROOT_BLOCK_DOM_ATTRS.id}]`

function shouldIgnoreRootBlockParseElement(element) {
  if (!element || typeof element.getAttribute !== 'function') {
    return false
  }

  return (
    element.getAttribute(ROOT_BLOCK_DOM_ATTRS.placeholder) === 'true' ||
    element.getAttribute(ROOT_BLOCK_DOM_ATTRS.renderMode) === ROOT_BLOCK_DOM_RENDER_MODES.placeholder ||
    element.classList?.contains(ROOT_BLOCK_DOM_CLASSES.virtualPlaceholder) === true
  )
}

function logRootBlockColorDebug(...args) {
  if (!getFlag('renderVirtualizationDebugLogging')) return
  console.info(...args)
}

/**
 * RootBlock 扩展
 * 作为内容块的容器节点，附加唯一ID和批注数据
 * 支持拖拽排序功能
 */
export const RootBlock = Node.create({
  name: 'rootBlock',
  
  // 应用分组和内容规则
  group: NODE_GROUPS.BLOCK_CONTAINER,
  content: `${NODE_GROUPS.BLOCK_CONTENT}{1}`,
  
  // 添加这些重要属性
  priority: 50,
  defining: true,
  selectable: true,
  
  // 定义可序列化的属性
  addAttributes() {
    return {
      // 唯一ID属性
      id: {
        default: () => generateRootBlockId(),
        parseHTML: element => element.getAttribute('data-id') || generateRootBlockId(),
        renderHTML: attributes => {
          return {
            'data-id': attributes.id,
          }
        }
      },
      // 批注ID数组属性
      annotationIds: {
        default: [],
        parseHTML: element => {
          const annotationIdsAttr = element.getAttribute('data-annotation-ids')
          return annotationIdsAttr ? JSON.parse(annotationIdsAttr) : []
        },
        renderHTML: attributes => {
          return {
            'data-annotation-ids': JSON.stringify(attributes.annotationIds),
          }
        }
      },
      // 额外可用于拖拽排序的位置属性
      position: {
        default: null,
        parseHTML: element => {
          const pos = element.getAttribute('data-position')
          return pos ? parseInt(pos, 10) : null
        },
        renderHTML: attributes => {
          if (attributes.position === null) {
            return {}
          }
          return {
            'data-position': attributes.position,
          }
        }
      },
      // 是否正在拖拽中
      isDragging: {
        default: false,
        parseHTML: element => element.getAttribute('data-dragging') === 'true',
        renderHTML: attributes => {
          if (!attributes.isDragging) {
            return {}
          }
          return {
            'data-dragging': 'true',
          }
        }
      },
      // 背景颜色
      backgroundColor: {
        default: null,
        parseHTML: element => element.getAttribute('data-background-color') || null,
        renderHTML: attributes => {
          if (!attributes.backgroundColor) {
            return {}
          }
          return {
            'data-background-color': attributes.backgroundColor,
          }
        }
      },
      // 文字颜色
      textColor: {
        default: null,
        parseHTML: element => element.getAttribute('data-text-color') || null,
        renderHTML: attributes => {
          if (!attributes.textColor) {
            return {}
          }
          return {
            'data-text-color': attributes.textColor,
          }
        }
      }
    }
  },
  
  // 使用 Vue 组件作为正常 hydrated 节点视图。
  // render virtualization 只把离屏 rootBlock 切成 placeholder；入屏块必须保持完整编辑 chrome。
  addNodeView() {
    return (nodeViewProps) => {
      const startedAt = performance.now();
      const getBlockId = (node) => {
        const attrs = node.attrs || {};
        return typeof attrs.id === 'string' ? attrs.id : '';
      };
      const resolveMode = (node, decorations) => {
        const blockId = getBlockId(node);
        const owner = nodeViewProps.editor;
        return resolveRootBlockRenderMode({
          blockId,
          decorations,
          editorState: owner?.state,
          virtualizationEnabled: shouldUseVirtualRootBlockRenderingForOwner(owner),
        });
      };
      const shouldKeepVueNodeView = (node, decorations) => {
        const virtualRootBlockRenderingEnabled = shouldUseVirtualRootBlockRenderingForOwner(nodeViewProps.editor);
        if (!virtualRootBlockRenderingEnabled) return true;
        return resolveMode(node, decorations) !== 'placeholder';
      };

      const virtualRootBlockRenderingEnabled = shouldUseVirtualRootBlockRenderingForOwner(nodeViewProps.editor)
      const renderMode = resolveMode(nodeViewProps.node, nodeViewProps.decorations)
      const shouldRenderPlaceholder =
        virtualRootBlockRenderingEnabled &&
        renderMode === 'placeholder';

      if (shouldRenderPlaceholder) {
        const blockId = getBlockId(nodeViewProps.node);
        const placeholderView = createPlaceholderShellView(nodeViewProps.node, {
          resolveMode,
          runtimeRegistryOwner: nodeViewProps.editor,
          estimatedHeight: getRenderVirtualizationBlockHeight(blockId, nodeViewProps.editor),
        });
        incrementNodeViewCount('placeholder', performance.now() - startedAt);
        return placeholderView;
      }

      // 中文说明：
      // - placeholder 才是大文档虚拟化真正省成本的部分，它会阻止 PM 为离屏块创建内容子树；
      // - 阶段 2 开始，虚拟化大文档的 hydrated rootBlock 也使用原生 DOM 壳，
      //   先把滚动热路径从 VueNodeViewRenderer 中解耦；
      // - BlockChrome 中央化属于阶段 3。在这之前，大文档 hydrated DOM 壳只保证正文编辑和
      //   runtime/visibility/handshake 协议，不再在每个 rootBlock 内挂 Vue chrome；
      // - 只有“Shell 压测/非虚拟化”路径才继续使用 RootBlockShellView，避免大文档编辑体验退化成无 chrome 壳。
      if (virtualRootBlockRenderingEnabled) {
        const domView = createRootBlockDomNodeView(nodeViewProps.node, {
          getPos: nodeViewProps.getPos,
          runtimeRegistryOwner: nodeViewProps.editor,
          resolveMode,
        });
        incrementNodeViewCount('dom', performance.now() - startedAt);
        return domView;
      }

      if (shouldUseRootBlockShellForOwner(nodeViewProps.editor) && !virtualRootBlockRenderingEnabled) {
        const shellView = createRootBlockShellView(nodeViewProps.node, {
          resolveMode,
          lifecycleOwner: nodeViewProps.editor,
        });
        incrementNodeViewCount('shell', performance.now() - startedAt);
        return shellView;
      }

      const vueNodeView = VueNodeViewRenderer(BlockView, {
        update({ oldNode, oldDecorations, newNode, newDecorations, updateProps }) {
          if (newNode.type !== oldNode.type) return false;
          // 中文说明：NodeView 类型是在创建时决定的。小文档全量 Vue NodeView 切到
          // 大文档虚拟化时，如果这里继续返回 true，旧 Vue NodeView 会被复用为离屏块，
          // ProseMirror 就不会重建成 placeholder，导致窗口统计和真实 DOM 都被污染。
          if (!shouldKeepVueNodeView(newNode, newDecorations)) return false;
          updateProps();
          return true;
        },
      });
      const nodeView = vueNodeView(nodeViewProps);
      incrementNodeViewCount('vue', performance.now() - startedAt);
      return nodeView;
    }
  },
  
  // 提供一个简化的renderHTML方法，用于初始化和序列化
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({
      class: ROOT_BLOCK_DOM_CLASSES.outer,
      [ROOT_BLOCK_DOM_ATTRS.nodeType]: ROOT_BLOCK_DOM_NODE_TYPES.outer,
    }, HTMLAttributes),
      ['div', {
        class: ROOT_BLOCK_DOM_CLASSES.body,
        [ROOT_BLOCK_DOM_ATTRS.nodeType]: ROOT_BLOCK_DOM_NODE_TYPES.body,
      }, 0]
    ]
  },
  
  // 从HTML解析节点
  // 注意rootblock的id和rootblockouter的data-id是完全相同的
  parseHTML() {
    return [
      {
        tag: ROOT_BLOCK_PARSE_SELECTOR,
        getAttrs: element => {
          // 虚拟化 placeholder 是渲染层外壳，不是真实文档内容。
          // 粘贴 / DOMParser 路径命中它时必须拒绝解析，避免把离屏占位块写回文档。
          if (shouldIgnoreRootBlockParseElement(element)) {
            return false
          }
          return null
        },
      }
    ]
  },
  
  // 添加块级操作命令
  addCommands() {
    return {
      // 添加新的根块
      addRootBlock: (attributes = {}) => ({ chain }) => {
        return chain()
          .insertContent({
            type: this.name,
            attrs: attributes,
            content: [{ 
              type: 'baseBlock',
              attrs: {
                blockType: 'base',
                placeholder: resolveCurrentEditorMessage('editor.placeholder.baseBlock')
              }
            }],
          })
          .run()
      },
      
      // 移动根块
      moveRootBlock: (fromPos, toPos) => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.deleteRange(fromPos.from, fromPos.to)
            .insert(toPos, fromPos.content)
        }
        
        return true
      },
      
      // 设置拖拽状态
      setDragging: (nodePos, isDragging) => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.setNodeMarkup(nodePos, undefined, { isDragging })
        }
        
        return true
      },
      
      // 注意：修订相关命令已迁移到 extensions/core/commands/RevisionCommands.js
      // 包括：acceptAllRevisionsInBlock, rejectAllRevisionsInBlock, restoreBlockContent, clearBlockRevisionMarks
      // 通过 CoreCommandsExtension 统一注册
      
      // ==================== 块颜色命令 ====================
      
      // 设置块颜色
      // ++ 修改策略 ++
      // - 背景颜色（backgroundColor）：应用到 RootBlock（保持圆角）
      // - 文字颜色（textColor）：应用到内层块（继承到子元素）
      // - 为了保证「块颜色」与「行内文字颜色」同属一套系统：
      //   - 当通过 BlockColorPicker 设置块文字色时，会统一覆盖整个块：
      //     - 更新内层块的 textColor 属性
      //     - 同时清除该块范围内所有 textColor 行内 mark，避免旧的局部颜色盖住块级颜色
      //   - 当清除块文字色（colorValue 为 null）时，同样会清除所有 textColor 行内 mark
      setBlockColor: (nodePos, colorType, colorValue) => ({ tr, dispatch, state }) => {
        logRootBlockColorDebug('[RootBlock] setBlockColor 命令被调用');
        logRootBlockColorDebug('[RootBlock] nodePos:', nodePos);
        logRootBlockColorDebug('[RootBlock] colorType:', colorType);
        logRootBlockColorDebug('[RootBlock] colorValue:', colorValue);
        
        if (dispatch) {
          const rootBlockNode = state.doc.nodeAt(nodePos);
          logRootBlockColorDebug('[RootBlock] 找到的根块节点:', rootBlockNode);
          logRootBlockColorDebug('[RootBlock] 节点类型:', rootBlockNode?.type.name);
          
          if (!rootBlockNode || rootBlockNode.type.name !== 'rootBlock') {
            console.warn('[setBlockColor] 未找到有效的 rootBlock 节点');
            return false;
          }
          
          if (colorType === 'background') {
            // 背景色应用到 RootBlock
            logRootBlockColorDebug('[RootBlock] 应用背景色到 rootBlock');
            const newRootAttrs = { ...rootBlockNode.attrs };
            newRootAttrs.backgroundColor = colorValue;
            tr.setNodeMarkup(nodePos, undefined, newRootAttrs);
          } else if (colorType === 'text') {
            // 文字色应用到内层块，并同步到整块的行内 textColor mark（统一一套颜色系统）
            const contentBlockNode = rootBlockNode.firstChild;
            if (!contentBlockNode) {
              console.warn('[setBlockColor] rootBlock 没有内层块');
              return false;
            }

            logRootBlockColorDebug('[RootBlock] 内层块类型:', contentBlockNode.type.name);
            logRootBlockColorDebug('[RootBlock] 内层块当前属性:', contentBlockNode.attrs);

            const newContentAttrs = { ...contentBlockNode.attrs };
            newContentAttrs.textColor = colorValue;

            logRootBlockColorDebug('[RootBlock] 新的内层块属性:', newContentAttrs);

            // 设置内层块的属性（块级文字色，供 BlockView / 列表前缀等结构使用）
            tr.setNodeMarkup(nodePos + 1, undefined, newContentAttrs);
            logRootBlockColorDebug('[RootBlock] setNodeMarkup 已调用（应用文字色到内层块）');

            // 额外步骤：先清除当前 rootBlock 范围内所有 textColor 行内 mark，
            // 然后在需要时为整块重新打上新的 textColor mark，
            // 使「块菜单」与「工具栏行内颜色」共用同一套 mark 机制。
            const textColorMarkType = state.schema.marks.textColor;
            if (textColorMarkType) {
              const blockStart = nodePos + 1; // rootBlock 内容起始位置
              const blockEnd = nodePos + rootBlockNode.nodeSize - 1; // rootBlock 内容结束位置
              logRootBlockColorDebug('[RootBlock] 清除行内 textColor mark，范围:', blockStart, blockEnd);
              tr.removeMark(blockStart, blockEnd, textColorMarkType);

              // 如果 colorValue 非空，为整块重新添加统一的 textColor mark；
              // 如果 colorValue 为空（清除块颜色），则仅移除 mark，回退到默认文本颜色。
              if (colorValue) {
                logRootBlockColorDebug('[RootBlock] 为整块添加新的 textColor mark，颜色:', colorValue);
                tr.addMark(blockStart, blockEnd, textColorMarkType.create({ color: colorValue }));
              }
            }
          }
        }
        
        return true
      }
    }
  },
})

export default RootBlock
