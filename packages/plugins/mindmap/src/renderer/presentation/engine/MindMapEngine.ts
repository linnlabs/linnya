import type { MindMapInstance, Options } from '../../domain/types/index'
import { createDomStructure, resolveElement, resolveOptionalElement, resolveTheme } from './dom'
import { createDragMoveHelper } from '../../shared/utils/dragDrop/dragMoveHelper'
import { createBus } from '../../shared/utils/events/eventBus'
import initMouseEvent from '../../interaction/mouseHandlers'
import { main, sub } from '../../shared/utils/layout/generateBranch'
import { defaultExpanderRenderer } from '../../shared/utils/dom/expanderRenderer'
import { installMindMapReflowScheduler } from '../../shared/utils/reflow'
import { installMindMapCommands } from '../../domain/commands'
import { watch } from 'vue'
import { useMindMapStore } from '../../domain/store/mindmapStore'
import { flickerLog } from '../../shared/utils/debug/flickerDebug'

class MindMapEngine {
  constructor(private mind: MindMapInstance) {}

  mount(options: Options) {
    const mind = this.mind
    const {
      el,
      direction,
      locale,
      draggable,
      editable,
      contextMenu,
      toolBar,
      keypress,
      mouseSelectionButton,
      selectionContainer,
      before,
      newTopicName,
      allowUndo,
      generateMainBranch,
      generateSubBranch,
      overflowHidden,
      theme,
      alignment,
      scaleSensitivity,
      scaleMax,
      scaleMin,
      handleWheel,
      markdown,
      imageProxy,
      renderers,
      expanderRenderer,
    } = options

    const elRoot = resolveElement(el, 'MindMap: el is not a valid element')
    const selectionRoot = resolveOptionalElement(
      selectionContainer,
      'MindMap: selectionContainer is not a valid element'
    )

    elRoot.style.position = 'relative'
    elRoot.innerHTML = ''
    mind.el = elRoot
    mind.disposable = []
    mind.before = before || {}
    mind.locale = locale || 'en'
    // newTopicName 保留为配置项，但目前不使用（所有新建节点统一使用"子主题"）
    mind.newTopicName = newTopicName || 'New Node'
    mind.contextMenu = contextMenu ?? true
    mind.toolBar = toolBar ?? true
    mind.keypress = keypress ?? true
    mind.mouseSelectionButton = mouseSelectionButton ?? 0
    mind.direction = direction ?? 1
    mind.draggable = draggable ?? true
    mind.editable = editable ?? true
    mind.allowUndo = allowUndo ?? true
    mind.scaleSensitivity = scaleSensitivity ?? 0.05
    mind.scaleMax = scaleMax ?? 1.4
    mind.scaleMin = scaleMin ?? 0.2
    mind.generateMainBranch = generateMainBranch || main
    mind.generateSubBranch = generateSubBranch || sub
    mind.overflowHidden = overflowHidden ?? false
    mind.alignment = alignment ?? 'root'
    mind.handleWheel = handleWheel ?? true
    mind.markdown = markdown || undefined
    mind.imageProxy = imageProxy || undefined
    const rendererOverrides = renderers ?? {}
    mind.renderers = {
      expander: rendererOverrides.expander ?? expanderRenderer ?? defaultExpanderRenderer,
    }
    mind.currentNodes = []
    mind.currentArrow = null
    /**
     * 拖拽状态初始化（根因修复）
     *
     * 中文说明：
     * - AutoRefresh 的门禁会读取 `mind.dragged.length` 判断是否处于拖拽中；
     * - 类型契约：`MindMapInstance.dragged: Topic[] | null`（见 `domain/types/index.ts`）；
     * - 但历史上这里未初始化，运行时可能为 undefined，导致门禁抛错并中断刷新链路；
     * - 因此必须在 engine mount 时显式初始化为 null，保证跨模块一致。
     */
    mind.dragged = null
    mind.scaleVal = 1
    mind.tempDirection = null
    mind.moveMode = false

    mind.dragMoveHelper = createDragMoveHelper(mind)
    mind.bus = createBus()

    // 文档上下文初始化
    mind.documentId = null
    mind.structureRevision = 0

    /**
     * 生命周期信号：documentReady 单点发出（兜底）
     *
     * 中文说明：
     * - 正常情况下 setDocumentSession 会在 applyContent/init 前同步 fire documentReady
     * - 但如果文档会话早于 mind 实例绑定（pendingContent 场景），这里的 watcher 负责兜底发出 documentReady
     * - 该 watcher 只在 MindMapEngine 生命周期内存在，并在 destroy 时自动 stop
     */
    const store = useMindMapStore()
    let lastFiredDocId: string | null = null
    const stopWatch = watch(
      () => store.currentDocumentId,
      (docId, prev) => {
        if (!docId) return
        // 避免与 setDocumentSession 的同步 fire 重复
        if (lastFiredDocId === docId) return
        lastFiredDocId = docId
        mind.documentId = docId
        const reason: 'open' | 'reload' | 'switch' =
          prev === null ? 'open' : prev === docId ? 'reload' : 'switch'
        mind.bus.fire('lifecycle:documentReady', {
          documentId: docId,
          reason,
          timestamp: Date.now(),
        })
      },
      { immediate: true }
    )
    mind.disposable.push(() => stopWatch())

    // 安装 ReflowScheduler（重算调度器）
    // 中文说明：统一管理"尺寸变化 -> 连线重算"的调度，避免散落调用导致的抖动/卡顿
    const reflowScheduler = installMindMapReflowScheduler(mind, {
      // 中文说明：默认关闭日志，避免控制台刷屏；需要调试时再手动开启
      debug: false,
    })
    mind.reflowScheduler = reflowScheduler

    /**
     * 最近一次“明确归因”的 reflow 时间戳（performance.now）
     *
     * 中文说明（根因修复：杜绝 Enter 新建兄弟节点后仍然闪一下）：
     * - 我们有一个 ResizeObserver 会在 nodes 尺寸变化时触发 `requestReflow('nodes:resize')`；
     * - 但“新增节点/编辑完成/addon 更新”本来就会显式触发 reflow（node-operation/addons/...），
     *   ResizeObserver 随后立刻再触发一次 nodes:resize，会造成短时间内重复 linkDiv（重画线），体感就是“闪一下”；
     * - nodes:resize 的设计初衷是兜底“字体/CSS 晚到”等无归因变化，因此应当在“刚发生过明确 reflow”的短窗口内抑制。
     */
    let lastExplicitReflowAt = -Infinity
    let lastExplicitReflowReason: string | null = null

    const markExplicitReflow = (reason: string) => {
      if (reason === 'nodes:resize') return
      lastExplicitReflowAt = performance.now()
      lastExplicitReflowReason = reason
    }

    mind.requestReflow = (reason) => {
      markExplicitReflow(reason)
      reflowScheduler.request(reason)
    }
    mind.requestReflowNow = (reason) => {
      markExplicitReflow(reason)
      reflowScheduler.forceFlush(reason)
    }
    mind.disposable.push(() => reflowScheduler.dispose())

    mind.theme = resolveTheme(theme)
    createDomStructure(mind, selectionRoot)

    /**
     * nodes 尺寸变化监听（根因修复）
     *
     * 中文说明：
     * - `linkDiv()` 的几何计算依赖 DOM 的真实尺寸（offsetWidth/offsetHeight/offsetTop 等）。
     * - 但在 Electron/SPA 首次启动进入 MindMap 时，存在“样式/字体/布局晚到”的情况：
     *   - mindmap chunk 的 CSS 刚注入，浏览器会在随后一帧才完成样式重排；
     *   - 或者字体首次加载完成后，文本度量发生变化，节点宽高会在 init/refresh 之后再次变化。
     * - 这类变化不是来自用户操作（不会走 node-operation / addons / rich-content 的显式 reflow 触发），
     *   因此会表现为：首屏 linkDiv 已执行，但随后节点几何变化，线条不再对齐，直到用户手动重载。
     *
     * 解决方案：
     * - 统一在引擎层观察 `mind.nodes`（me-nodes）的尺寸变化，任何变化都触发一次 requestReflow('nodes:resize')，
     *   由 ReflowScheduler 合并同帧请求，保证连线最终与稳定 DOM 对齐。
     *
     * 约束：
     * - 回调里必须先确认结构已存在（mm-root 已渲染），避免 mount 初期误触发导致 linkDiv 查询空节点报错。
     */
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        const hasRoot = Boolean(mind.map?.querySelector('mm-root'))
        if (!hasRoot) return
        // 中文说明（根因修复：避免重复 reflow 导致闪烁）：
        // - 若刚发生过“明确归因”的 reflow（node-operation/addons/...），nodes 的尺寸变化往往就是其直接结果；
        // - 此时再触发一次 nodes:resize 属于重复重画，会造成体感闪烁；
        // - 因此在短窗口内抑制 nodes:resize（仍保留其对“字体/CSS 晚到”的兜底价值）。
        const now = performance.now()
        const since = now - lastExplicitReflowAt
        const SUPPRESS_WINDOW_MS = 200
        if (since >= 0 && since < SUPPRESS_WINDOW_MS) {
          flickerLog('nodes:resize suppressed', {
            t: now,
            sinceMs: Math.round(since),
            lastExplicitReflowReason,
          })
          return
        }
        mind.requestReflow('nodes:resize')
      })
      ro.observe(mind.nodes)
      mind.disposable.push(() => ro.disconnect())
    }

    if (mind.overflowHidden) {
      mind.container.style.overflow = 'hidden'
    } else {
      mind.disposable.push(initMouseEvent(mind))
    }

    // 安装命令体系（Phase 1）
    // 中文说明：
    // - 必须在 bus、requestReflow、DOM 结构都就绪后安装
    // - 此时 mind.documentId 可能仍为 null（文档还未加载），这是正常的
    // - 命令执行时会检查 documentId 是否就绪
    installMindMapCommands(mind, {
      // 中文说明：默认关闭命令日志，避免控制台刷屏；需要调试时在 console 里调用：
      // mind.runCommand('debug:enableLogs', {}) 或 setCommandLoggerConfig({ enabled: true })
      debug: false,
    })
  }
}

export default MindMapEngine
