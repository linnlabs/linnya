import type { Topic } from '../../../domain/types/dom'
import type { MindMapInstance } from '../../../domain/types/index'
import type { Behaviour } from '../core'
import SelectionArea from '../core'
import { shouldIgnoreSelection } from '../../../shared/utils/interactionGate'

export default function (mind: MindMapInstance) {
  const dedupeById = (nodes: Topic[]): Topic[] => {
    const map = new Map<string, Topic>()
    for (const el of nodes) {
      const id = (el as Topic).nodeObj?.id as string
      if (id) {
        // 始终以“较新的 DOM 元素”覆盖旧引用，避免重复与幽灵引用
        map.set(id, el)
      }
    }
    return Array.from(map.values())
  }

  // 仅允许左键触发选择引擎；右键用于上下文菜单，不应触发 selection 流程
  const triggers: Behaviour['triggers'] = [0]
  const selection = new SelectionArea({
    selectables: ['.map-container mm-topic'],
    boundaries: [mind.container],
    container: mind.selectionContainer,
    mindMapInstance: mind, // 传递 MindMap 实例
    // 宿主规则：从节点起点开始拖动时，不应进入框选拖拽（优先交给节点拖拽系统）
    suppressDragSelectionFromDownTarget: (el: Element) => Boolean(el.closest('mm-topic')),
    filterTarget: (target: HTMLElement, event: MouseEvent | TouchEvent) => {
      // 中文说明：
      // - 使用 InteractionGate 统一判断是否应该忽略选择
      // - 返回 false 表示"不交给 selection 引擎处理"

      // 1. 使用 InteractionGate 进行统一过滤
      const gateCtx = { target, event, boundary: mind.container }
      const gateDebugEnabled = mind.bus.debug.interactionGate.isEnabled()
      if (shouldIgnoreSelection(gateCtx, { debug: gateDebugEnabled })) {
        return false
      }

      // 2. 左键点击已选中节点：不交给 selection 引擎处理，保持当前选中不变
      const mouseEvt = event as MouseEvent
      if (
        mouseEvt?.button === 0 &&
        (target.tagName === 'MM-TOPIC' ? target : target.closest('mm-topic'))?.classList?.contains('selected')
      ) {
        return false
      }

      // 3. 空格/移动模式下不处理选择
      if (mind.spacePressed || mind.moveMode) return false

      // 4. 右键菜单内部点击不处理
      if (mind.container.querySelector('.context-menu')?.contains(target)) {
        return false
      }

      return true
    },
    debug: true,
    features: {
      // deselectOnBlur: true,
      touch: false,
    },
    behaviour: {
      triggers,
      // Scroll configuration.
      scrolling: {
        // On scrollable areas the number on px per frame is devided by this amount.
        // Default is 10 to provide a enjoyable scroll experience.
        speedDivider: 10,
        startScrollMargins: { x: 50, y: 50 },
      },
    },
  })
    .on('beforestart', ({ event }) => {
      // 仅在左键下处理 beforestart；右键完全不介入 selection 引擎
      const mouseEvt = event as MouseEvent
      if (mouseEvt && mouseEvt.button !== 0) {
        return false
      }
      if (!mouseEvt.ctrlKey && !mouseEvt.metaKey) {
        const target = event!.target as HTMLElement
        if (target.tagName === 'MM-TOPIC' && target.classList.contains('selected')) {
          // Normal click cannot deselect
          // Also, deselection CANNOT be triggered before dragging, otherwise we can't drag multiple targets!!
          return false
        }
        // trigger `move` event here
        mind.clearSelection()

        // 中文说明：清除浏览器原生的文本选区（例如 addon 中的文字选中），确保点击画布空白处时清除所有类型的选中状态
        if (window.getSelection) {
          window.getSelection()?.removeAllRanges()
        }
      }
      // comment.log('beforestart')
      const selectionAreaElement = selection.getSelectionArea()
      // 中文说明：框选框样式统一由 CSS 控制（mindmap.css 的 .selection-area），
      // 避免在 adapter 中硬编码颜色导致主题漂移（例如误变成蓝色）。
      selectionAreaElement.style.background = ''
      selectionAreaElement.style.border = ''
      if (selectionAreaElement.parentElement) {
        selectionAreaElement.parentElement.style.zIndex = '9999'
      }
      return true
    })
    // 中文说明：
    // - “拖动节点不应出现框选框”属于 selection 核心坐标/手势契约
    // - 已在 SelectionEngine.ts 内部基于“按下起点”统一实现
    .on(
      'move',
      ({
        store: {
          changed: { added, removed },
        },
      }) => {
        if (added.length > 0) {
          for (const el of added) {
            el.classList.add('selected')
          }
          // 基于 nodeObj.id 去重，避免 DOM 引用变化导致的重复
          const newNodes = added as Topic[]
          mind.currentNodes = dedupeById([...(mind.currentNodes || []), ...newNodes])
          
          mind.bus.fire(
            'state:selectNodes',
            (added as Topic[]).map(el => el.nodeObj)
          )
        }
        if (removed.length > 0) {
          for (const el of removed) {
            el.classList.remove('selected')
          }
          // 按 id 过滤，避免因 DOM 引用不同而无法正确移除
          const removedIds = new Set((removed as Topic[]).map(el => el.nodeObj?.id))
          mind.currentNodes = (mind.currentNodes || []).filter(el => !removedIds.has(el.nodeObj?.id))
          
          mind.bus.fire(
            'state:unselectNodes',
            (removed as Topic[]).map(el => el.nodeObj)
          )
        }
      }
    )
    .on('stop', ({ store }) => {
        // 在操作结束时，强制以 store 为准并去重（按 id）
        const stored = store.stored as Topic[]
        mind.currentNodes = dedupeById(stored)
        
        // 确保 DOM 类名正确（虽然 move 已经处理了，但这里是最终状态的再次确认）
        // 注意：这里只处理 stored 中的，不处理非 stored 但可能残留 selected 类的（这由 clearSelection 处理）
    })
  mind.selection = selection
  return () => {
    selection.destroy()
    mind.selection = undefined
  }
}
