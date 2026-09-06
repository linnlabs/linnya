import { defineStore } from 'pinia';
import { ref, shallowRef, computed } from 'vue';
import type { MindMapInstance, MindMapData, NodeObj } from '../types/index';
import type { Topic } from '../types/dom';
import type { MindMapMetadata, MindMapViewport } from '../../ipc/mindMapGateway';
import { getTranslate, generateUUID } from '../../shared/utils/index';
import { registerMindMapAdapter } from '../../file-handler/mindmapAdapterBridge';

type HotkeyOverride = {
  enabled?: boolean;
  handler?: (e: KeyboardEvent) => void;
};

export const useMindMapStore = defineStore('mindmap', () => {
  // 核心实例（使用 shallowRef 避免深层响应式代理带来的性能损耗）
  const mind = shallowRef<MindMapInstance | null>(null);

  // 文档上下文
  const currentDocumentId = ref<string | null>(null);
  const currentDocumentName = ref<string>('未命名思维导图');
  const documentMetadata = ref<MindMapMetadata | null>(null);
  const pendingContent = shallowRef<MindMapData | null>(null);
  const pendingApplyOptions = shallowRef<{
    reason: 'open' | 'reload' | 'switch'
    viewport?: MindMapViewport | null
    /**
     * 启动后首次进入 MindMap 页面时的首屏策略。
     *
     * 中文说明：
     * - 用户建议：首次打开应聚焦根节点居中，并根据图大小智能缩小；
     * - 之后再次进入同一页面则回到上次停留位置（沿用 viewportCache/metadata 逻辑）。
     * - 这里用一个显式开关把“首次进入”语义传到 applyContent，避免在 applyContent 里猜测路由/页面状态。
     */
    initialOpen?: boolean
  } | null>(null)
  const isApplyingDocument = ref(false);

  /**
   * 标识当前 MindMap 实例是否已加载了“最新”的文档内容。
   *
   * 中文说明（根因修复：消除切换文档时的闪烁）：
   * - 当切换文档时，MindMap 实例可能被重用（或新实例先 init 空文档）；
   * - 此时视口可能还在旧位置，或空文档在 (0,0)；
   * - 只有当 `applyContent` 完成且 `appliedDocumentIdByInstance` 匹配 `currentDocumentId` 时，
   *   才认为视图已“就绪”并显示给用户；
   * - 在此之前，UI 层应将画布透明度设为 0，避免用户看到“旧内容/空内容在错误位置”的中间态。
   */
  const isMindMapReady = ref(false)

  // ---------------------------------------------------------------------------
  // 视口缓存（关键：跨视图切换时保持“上次浏览位置”）
  // ---------------------------------------------------------------------------
  /**
   * 中文说明（根因与修复策略）：
   * - MindMap 页面使用 `v-if` 条件渲染，切换视图时组件会被卸载并重建；
   * - 视口（translate/scale）本质是运行态 UI 状态，不一定会触发 operation，因此不会进入 dirty/save；
   * - 若仅依赖后端 metadata.viewport，则“只移动画布不改内容”的场景切回会丢失位置；
   * - 因此在 store 内维护按 documentId 的内存级 viewport 缓存，优先用于同一启动周期内的恢复。
   */
  const viewportCacheByDocumentId = new Map<string, MindMapViewport>()

  /**
   * 视口锚点缓存（内存级）：把“用户当前看到的位置”表达为“相对根节点居中的偏移量”。
   *
   * 中文说明（根因修复：右偏/漂移 + addon/字体引起的布局变化）：
   * - 仅缓存绝对 translate(x,y) 会受到 layout 变化影响：同一份数据在不同帧/字体/Addon 下 root 的 offsetLeft 会变化；
   * - 这会导致“回到中心后 reload 右偏”“大图更明显”等现象；
   * - 解决：把 viewport 表达为 `rootCentered(dx,dy) + offset(x,y)`，当 layout 变化时重新计算 dx/dy 即可保持视觉稳定。
   *
   * 备注：
   * - 该锚点不写入后端（metadata.viewport 仍用绝对值），只用于同一启动周期内的稳定恢复与抗漂移。
   */
  const viewportAnchorByDocumentId = new Map<
    string,
    { offsetX: number; offsetY: number; scale: number }
  >()
  const pendingAnchorHydrationByDocumentId = new Set<string>()

  /**
   * 当前文档的最新 viewport（尽量与真实 DOM transform 同步）。
   * - 用于 `state:viewMoved` 的增量更新（x/y + dx/dy），避免每帧都解析 transform。
   */
  const currentViewport = ref<MindMapViewport>({ x: 0, y: 0, scale: 1 })

  /**
   * 记录“某个 MindMap 实例最后一次 apply 的 documentId”。
   *
   * 中文说明（这是本次问题的根因点）：
   * - `setMind(instance)` 在真实文档数据到达前，可能会先 `init(generateEmptyDocument())` 填一个空文档；
   * - 这样会让 `targetMind.nodeData` 变成 truthy，导致 `applyContent` 误判为“非首次加载”；
   * - 又因为 reason 在“切回同一文档”时通常是 reload，于是逻辑会跳过 viewport 恢复；
   * - 所以这里不能用 `nodeData` 判断“首次加载”，必须用“是否已应用过真实 document session”来判断。
   */
  const appliedDocumentIdByInstance = new WeakMap<MindMapInstance, string>()

  function isViewportDebugEnabled(): boolean {
    return (window as { __MM_VIEWPORT_DEBUG__?: boolean }).__MM_VIEWPORT_DEBUG__ === true
  }

  function viewportLog(message: string, data: Record<string, unknown>) {
    if (!isViewportDebugEnabled()) return
    console.log(`[MindMapViewport] ${message}`, data)
  }

  /**
   * 判断当前 viewport 更新是否“可信”。
   *
   * 中文说明：
   * - 切回页面会创建新实例，新实例在文档数据到达前可能先 init 空文档；
   * - 这个阶段的 transform/移动事件不应写入缓存，否则会覆盖“上次浏览位置”；
   * - 只有当该实例已经 apply 过当前 documentId，才允许把 viewport 写入缓存。
   */
  function canWriteViewportCache(): boolean {
    const docId = currentDocumentId.value
    const m = mind.value
    if (!docId || !m) return false
    const appliedDocId = appliedDocumentIdByInstance.get(m)
    return appliedDocId === docId
  }

  function getCachedViewport(documentId: string): MindMapViewport | null {
    return viewportCacheByDocumentId.get(documentId) ?? null
  }

  function cacheViewportForDocument(documentId: string, viewport: MindMapViewport) {
    viewportCacheByDocumentId.set(documentId, viewport)
    currentViewport.value = viewport

    // 中文说明：保持 documentMetadata.viewport 与运行态一致，便于后续 serialize/save 使用。
    // 注意：这里只更新 viewport/updatedAt，不猜测其他字段（不做“补丁式修复”）。
    if (documentMetadata.value) {
      documentMetadata.value = {
        ...documentMetadata.value,
        viewport,
        updatedAt: Date.now(),
      }
    }
  }

  function computeCenterDefault(instance: MindMapInstance): { dx: number; dy: number; origin: string } | null {
    const container = instance.container
    const map = instance.map
    const nodes = instance.nodes
    if (!container || !map || !nodes) return null
    // 中文说明（根因修复：避免切换回页面时“飞到很上面/空白”）：
    // - 新实例刚 mount 时，DOM 已创建但节点尚未渲染完成，root/nodes 的宽高可能为 0；
    // - 若此时用 anchor 计算 dx/dy，会得到错误基准，导致 translate 被算到极端位置；
    // - 因此必须在几何可用（宽高非 0）时才允许返回基准。
    if (container.offsetWidth === 0 || container.offsetHeight === 0) return null

    // alignment: 'root' | 'nodes'
    const alignment = instance.alignment
    if (alignment === 'root') {
      const root = map.querySelector('mm-root')
      if (!(root instanceof HTMLElement)) return null
      if (root.offsetWidth === 0 || root.offsetHeight === 0) return null
      const pT = root.offsetTop
      const pL = root.offsetLeft
      const pW = root.offsetWidth
      const pH = root.offsetHeight
      const dx = container.offsetWidth / 2 - pL - pW / 2
      const dy = container.offsetHeight / 2 - pT - pH / 2
      return { dx, dy, origin: `${pL + pW / 2}px 50%` }
    }

    // nodes 对齐：以整个 nodes 包围盒为中心（与 viewControls.ts 保持一致）
    if (nodes.offsetWidth === 0 || nodes.offsetHeight === 0) return null
    const dx = (container.offsetWidth - nodes.offsetWidth) / 2
    const dy = (container.offsetHeight - nodes.offsetHeight) / 2
    return { dx, dy, origin: '50% 50%' }
  }

  function updateViewportAnchorCache(documentId: string, instance: MindMapInstance, viewport: MindMapViewport) {
    const base = computeCenterDefault(instance)
    if (!base) return
    viewportAnchorByDocumentId.set(documentId, {
      offsetX: viewport.x - base.dx,
      offsetY: viewport.y - base.dy,
      scale: viewport.scale,
    })
  }

  function getAnchoredViewport(
    documentId: string,
    instance: MindMapInstance,
    fallback: MindMapViewport | null
  ): MindMapViewport | null {
    const base = computeCenterDefault(instance)
    if (!base) return fallback
    const anchor = viewportAnchorByDocumentId.get(documentId) ?? null
    if (!anchor) return fallback
    return {
      x: base.dx + anchor.offsetX,
      y: base.dy + anchor.offsetY,
      scale: anchor.scale,
    }
  }

  function applyViewportToInstance(instance: MindMapInstance, viewport: MindMapViewport) {
    if (!instance.map) return
    const base = computeCenterDefault(instance)
    if (base) {
      instance.map.style.transformOrigin = base.origin
    }
    instance.map.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`
    instance.scaleVal = viewport.scale
  }

  function getEffectiveViewportForDocument(documentId: string, incoming: MindMapViewport | null | undefined) {
    // 优先用内存缓存（同一启动周期内更“新”）
    const cached = getCachedViewport(documentId)
    return cached ?? incoming ?? null
  }

  function readViewportFromMindInstance(instance: MindMapInstance): MindMapViewport | null {
    if (!instance.map) return null
    const transform = instance.map.style.transform || 'translate(0px, 0px) scale(1)'
    const { x, y } = getTranslate(transform)
    return {
      x,
      y,
      scale: instance.scaleVal ?? 1,
    }
  }

  /**
   * 采集当前实例的 viewport，并写入缓存。
   * - 用于缩放/打开/恢复/卸载前等“可能没有 viewMoved 事件”的场景。
   */
  function captureViewportSnapshot() {
    if (!mind.value || !currentDocumentId.value) return
    if (!canWriteViewportCache()) {
      viewportLog('captureViewportSnapshot ignored (instance not applied yet)', {
        currentDocumentId: currentDocumentId.value,
        mindDocumentId: mind.value.documentId,
        appliedDocumentId: appliedDocumentIdByInstance.get(mind.value),
      })
      return
    }
    const vp = readViewportFromMindInstance(mind.value)
    if (!vp) return
    cacheViewportForDocument(currentDocumentId.value, vp)
    // 中文说明：
    // - anchor 用于“跨 layout 变化的稳定恢复”，不应在“未就绪/中间态”阶段被覆写；
    // - 因此仅在画布 ready 后（用户真实可见的状态）才更新 anchor。
    if (isMindMapReady.value) {
      updateViewportAnchorCache(currentDocumentId.value, mind.value, vp)
    }
    viewportLog('captureViewportSnapshot', {
      documentId: currentDocumentId.value,
      viewport: vp,
    })
  }

  // 响应式状态
  const currentNodes = ref<Topic[]>([]);
  const scale = ref(1);
  const direction = ref<number | null>(null);
  const isFocusMode = ref(false);
  const isEditingInput = ref(false);
  const hotkeyConfig = ref<Record<string, HotkeyOverride>>({});
  const moveMode = ref(false);

  // 计算属性
  const currentNode = computed(() => {
    if (currentNodes.value.length === 0) return null;
    return currentNodes.value[currentNodes.value.length - 1];
  });

  const hasSelection = computed(() => currentNodes.value.length > 0);
  const isRootSelected = computed(() => {
    const node = currentNode.value;
    return node ? node.tagName === 'MM-ROOT' || node.parentElement?.tagName === 'MM-ROOT' : false;
  });

  // Actions
  /**
   * 监听几何 flush，并在 layout 变化后“重基准”视口。
   *
   * 中文说明（根因修复：右偏/漂移，不引入额外等待）：
   * - Addon/字体/CSS 可能在文档已显示后继续改变节点几何；
   * - 仅缓存绝对 translate 会让视图在后续 layout 变化时产生漂移；
   * - 这里在每次 geometryFlushed 后用 anchor 重新计算 translate，保持“相对根节点居中”的视觉位置稳定。
   */
  let disposeGeometryRebaseListener: (() => void) | null = null

  function setMind(instance: MindMapInstance | null) {
    // 清理旧实例监听
    if (disposeGeometryRebaseListener) {
      disposeGeometryRebaseListener()
      disposeGeometryRebaseListener = null
    }

    mind.value = instance;
    // 新实例（或置空）时，重置就绪状态为 false（隐藏画布）
    isMindMapReady.value = false

    if (instance) {
      instance.moveMode = moveMode.value;
      // 中文说明：当 MindMap 实例创建早于文档会话时，确保实例拿到当前 documentId
      instance.documentId = currentDocumentId.value;

      // 中文说明（减少“先闪到中心”的视觉抖动）：
      // - 切回页面时，新的实例会在真实文档数据到达前先 init 一个空文档占位；
      // - 因此这里优先把 viewport 预设为缓存值（若存在），避免首帧出现在 (0,0)。
      const docId = currentDocumentId.value
      if (docId && instance.map) {
        const cachedVp = getCachedViewport(docId)
        if (cachedVp) {
          // 中文说明：
          // - setMind 发生在内容 apply 前，此时几何可能尚不可用；
          // - 这里仅做“绝对 viewport 预设”，用于避免首帧停在 (0,0)；
          // - anchor 恢复交给 applyContent/geometryFlushed（确保基准稳定）。
          applyViewportToInstance(instance, cachedVp)
        }
      }

      if (pendingContent.value) {
        const options =
          pendingApplyOptions.value ?? { reason: 'open', viewport: documentMetadata.value?.viewport ?? null }
        applyContent(instance, pendingContent.value, options);
        pendingContent.value = null;
        pendingApplyOptions.value = null
      } else if (mind.value && !mind.value.nodeData) {
        // 若还没有任何数据，尝试生成一个默认空文档，防止操作报错
        mind.value.init(generateEmptyDocument());
        // 注意：init 空文档不代表 ready，isMindMapReady 仍保持 false（隐藏）
      }
      syncState();

      // 安装几何 flush 监听（用于持续重基准，避免右偏/漂移）
      const handler = (payload: {
        reasons: string[]
        coalescedCount: number
        durationMs: number
        structureRevision: number
        timestamp: number
        txId?: string
        txIds?: string[]
      }) => {
        const docId = currentDocumentId.value
        if (!docId) return
        if (mind.value !== instance) return
        // 仅对“该实例已经 apply 过当前文档”的情况下生效，避免空文档占位阶段污染
        const appliedDocId = appliedDocumentIdByInstance.get(instance) ?? null
        if (appliedDocId !== docId) return

        // anchor 水合（仅一次）：
        // - 当历史只提供了绝对 viewport（无 anchor）时，我们在第一次几何 flush 后再把它转成 anchor；
        // - 这样避免“恢复时基准未稳定 → anchor 被写歪 → 下次打开继续偏”的累积漂移。
        if (pendingAnchorHydrationByDocumentId.has(docId) && !viewportAnchorByDocumentId.has(docId)) {
          const vp = readViewportFromMindInstance(instance)
          if (vp) {
            updateViewportAnchorCache(docId, instance, vp)
            pendingAnchorHydrationByDocumentId.delete(docId)
          }
        }

        // 只在可能影响节点几何的 reasons 下重基准，避免无意义频繁写 transform
        const affects =
          payload.reasons.includes('addons:content') ||
          payload.reasons.includes('nodes:resize') ||
          payload.reasons.includes('core:init') ||
          payload.reasons.includes('core:refresh')
        if (!affects) return

        const anchored = getAnchoredViewport(docId, instance, null)
        if (!anchored) return
        applyViewportToInstance(instance, anchored)
        cacheViewportForDocument(docId, anchored)
        // 这里不更新 offset，只保持 anchor 表达（cacheViewport 的绝对值更新即可）
      }

      instance.bus.addListener('lifecycle:geometryFlushed', handler)
      disposeGeometryRebaseListener = () => {
        instance.bus.removeListener('lifecycle:geometryFlushed', handler)
      }
    } else {
      resetState();
    }
  }

  function generateEmptyDocument(): MindMapData {
    return {
      nodeData: {
        id: generateUUID(),
        // 中心节点采用"未命名主题"作为默认占位
        topic: currentDocumentName.value || '未命名主题',
        children: [],
      },
      direction: 1,
    };
  }

  /**
   * 应用文档内容到现有 MindMap 实例
   *
   * 中文说明（稳定性关键点）：
   * - `init()` 会安装 runtime plugins，但**不再**默认调用 `toCenter()`（视口由 store 统一调度）；
   * - 若每次打开/刷新都调用 `init()`，会导致：
   *   1) 视口跳动（先居中再被外部快照拉回，视觉“闪”）
   *   2) runtime plugins 重复安装（disposable 叠加，潜在内存泄漏/重复副作用）
   * - 因此约束为：**首次加载使用 init，后续一律使用 refresh(data)**。
   */
  function applyContent(
    targetMind: MindMapInstance,
    content: MindMapData,
    options: {
      reason: 'open' | 'reload' | 'switch'
      viewport?: MindMapViewport | null
      initialOpen?: boolean
    }
  ) {
    isApplyingDocument.value = true;
    // 中文说明：把 docId 提前到 try/finally 外层，供 finally 做严格一致性校验（避免闪烁）
    const docId = currentDocumentId.value
    // 中文说明：把“是否首次 apply 到该实例”提升到 finally 可见（用于区分 view-switch reload vs AutoRefresh reload）
    let isFirstApplyInThisInstance = false
    try {
      const lastAppliedDocId = appliedDocumentIdByInstance.get(targetMind) ?? null
      isFirstApplyInThisInstance = lastAppliedDocId === null

      // 强制移除可能残留的 transition（例如来自 smooth move 或 scrollIntoView），
      // 避免在切换文档/恢复视口时产生意料之外的动画（表现为“闪烁”或“乱飞”）。
      if (targetMind.map) {
        targetMind.map.style.transition = 'none'
      }

      viewportLog('applyContent start', {
        documentId: docId,
        reason: options.reason,
        isFirstApplyInThisInstance,
        lastAppliedDocId,
        hasNodeDataBefore: Boolean(targetMind.nodeData),
        incomingViewport: options.viewport ?? null,
        cachedViewport: docId ? getCachedViewport(docId) : null,
        transformBefore: targetMind.map?.style?.transform ?? null,
        scaleBefore: targetMind.scaleVal ?? null,
      })

      // 1) 首次加载：必须 init（安装 runtime plugins）
      // 2) 后续加载：必须 refresh（避免重复插件 + 避免强制居中）
      if (!targetMind.nodeData) {
        targetMind.init(content);
      } else {
        targetMind.refresh(content);
      }
      // 中文说明：
      // - 文档会话 apply 属于“加载外部事实”，不是用户在当前画布上的一步操作；
      // - history 的撤销基准必须在真实内容落地后重置，否则首个 undo 会回到 setMind 阶段的空占位图。
      targetMind.resetHistoryBaseline?.('document-session-applied')

      // 中文说明（根因修复：view-switch 后 reason=reload 但实例是新建）：
      // - App.vue 用 v-if 切页面，会卸载 MindMapView；回来时会创建新实例；
      // - file-manager 仍会打开同一 documentId，因此 reason 可能是 reload；
      // - 对新实例而言必须恢复 viewport，否则会回到默认 transform（看起来像“记忆位置丢失”）。
      if (isFirstApplyInThisInstance && options.reason !== 'open') {
        const vp = options.viewport
        if (vp) {
          // 优先用“锚点视口”恢复，避免因 layout 变化导致右偏/漂移
          const anchored = docId ? getAnchoredViewport(docId, targetMind, vp) : vp
          applyViewportToInstance(targetMind, anchored ?? vp)
        }
      }

      syncState();
      // 中文说明：applyContent 可能通过 restore/toCenter 直接写 transform，不一定会触发 state:viewMoved；
      // 因此这里强制采集一次，确保缓存与 DOM 一致。
      if (docId) {
        // 记录该实例已应用过真实文档（用于区分“空文档占位 init”与真正打开）
        appliedDocumentIdByInstance.set(targetMind, docId)

        viewportLog('applyContent end', {
          documentId: docId,
          reason: options.reason,
          isFirstApplyInThisInstance,
          transformAfter: targetMind.map?.style?.transform ?? null,
          scaleAfter: targetMind.scaleVal ?? null,
          cachedAfter: getCachedViewport(docId),
        })
      }
    } finally {
      isApplyingDocument.value = false;

      // 中文说明（收敛职责 + 降低延迟）：
      // - 视口策略不等待额外元数据，避免大图首次打开产生不必要的延迟
      // - 首次进入：立即 scaleFit()+toCenter()
          // - 非首次：按“根节点锚点视口”恢复，避免字体/CSS 变化造成右偏
      // - 后续布局变化由 setMind() 的 geometryFlushed listener 持续重基准
      const finalDocId = docId
      const finalInstance = targetMind

      const markReadyIfConsistent = () => {
        const m = mind.value
        if (!m) return
        if (m !== finalInstance) return
        if (currentDocumentId.value !== finalDocId) return
        const applied = appliedDocumentIdByInstance.get(m) ?? null
        if (applied !== finalDocId) return
        isMindMapReady.value = true
      }

      if (!finalDocId || typeof window === 'undefined') return

      window.requestAnimationFrame(() => {
        if (options.initialOpen === true) {
          // 保护性检查：确保 DOM 元素存在（测试环境或极端卸载场景可能为空）
          if (finalInstance.nodes && finalInstance.container) {
            finalInstance.scaleFit()
            finalInstance.toCenter()
          }

          // 监听初始结构完成后的几何刷新，避免首次布局尚未稳定时计算适应比例。
          // 设置 2000ms 超时，避免长期监听
          const TIMEOUT_MS = 2000
          let timer: number | null = null
          
          const cleanup = () => {
            if (finalInstance.bus) {
              finalInstance.bus.removeListener('lifecycle:geometryFlushed', reFitHandler)
            }
            if (timer) {
              window.clearTimeout(timer)
              timer = null
            }
          }

          const reFitHandler = (payload: { reasons: string[] }) => {
            if (payload.reasons.includes('nodes:resize') || payload.reasons.includes('core:refresh')) {
              if (finalInstance.nodes && finalInstance.container) {
                finalInstance.scaleFit()
                finalInstance.toCenter()
              }
              
              // 触发一次后即可移除，假设 Addon 加载通常是批量完成的；
              // 若分批加载导致多次跳动体验也不好，优先保证第一次大批量加载后的位置正确。
              cleanup()
            }
          }

          if (finalInstance.bus) {
            finalInstance.bus.addListener('lifecycle:geometryFlushed', reFitHandler)
            timer = window.setTimeout(cleanup, TIMEOUT_MS)
          }
        } else {
          const vp = options.viewport
          if (vp) {
            // 中文说明：
            // - 恢复时不要覆写 anchor（否则基准不稳定会导致 offset 累积漂移）；
            // - 若已有 anchor，则按 anchor 恢复；否则先按绝对值恢复，并等待后续 geometryFlushed 做一次 anchor 水合。
            const anchored = getAnchoredViewport(finalDocId, finalInstance, null)
            if (anchored) {
              applyViewportToInstance(finalInstance, anchored)
            } else {
              applyViewportToInstance(finalInstance, vp)
              pendingAnchorHydrationByDocumentId.add(finalDocId)
            }
          }
        }

        const vp = readViewportFromMindInstance(finalInstance)
        if (vp) {
          cacheViewportForDocument(finalDocId, vp)
          // 注意：这里不更新 anchor，避免在 layout 未稳定时覆写 offset
        }
        markReadyIfConsistent()
      })
    }
  }

  function setDocumentSession(payload: {
    documentId: string;
    name?: string | null;
    content: MindMapData;
    metadata?: MindMapMetadata | null;
  }) {
    const prev = currentDocumentId.value
    currentDocumentId.value = payload.documentId;
    currentDocumentName.value = payload.name ?? '未命名思维导图';
    documentMetadata.value = payload.metadata ?? null;

    // 若文档 ID 发生变化（切换文档），立即将就绪状态置为 false（隐藏画布），
    // 避免在 applyContent 完成前显示旧文档内容。
    if (prev !== payload.documentId) {
      isMindMapReady.value = false
    }

    const reason: 'open' | 'reload' | 'switch' =
      prev === null ? 'open' : prev === payload.documentId ? 'reload' : 'switch'

    // 中文说明：
    // - 判定是否应该执行“首次打开策略”（scaleFit + toCenter + Addon监听）。
    // - 场景 1: App 启动后第一个文档 (reason === 'open')。
    // - 场景 2: 切换文档 (reason === 'switch')，且内存无缓存（本次元首次打开），且 metadata 里的 viewport 为空或默认值。
    //   这解决了“先点小图再点大图”时，大图因被视为 switch 而跳过智能缩放，导致 Addon 撑大后漂移且未 fit 的问题。
    const cached = getCachedViewport(payload.documentId)
    const incoming = payload.metadata?.viewport
    const isIncomingDefault = !incoming || (incoming.x === 0 && incoming.y === 0 && incoming.scale === 1)

    const isInitialOpenAfterAppStart = 
      reason === 'open' || 
      ((reason === 'switch') && !cached && isIncomingDefault)

    // 中文说明：
    // - 启动后首次进入 MindMap 页面：忽略历史 viewport（metadata/缓存），走“根节点居中 + 按图大小智能缩小”
    // - 后续再次进入（reload/switch）：沿用现有逻辑，优先用内存缓存 viewport，回到“上次浏览位置”
    const effectiveViewport = isInitialOpenAfterAppStart
      ? null
      : getEffectiveViewportForDocument(payload.documentId, payload.metadata?.viewport)
    viewportLog('setDocumentSession', {
      prevDocumentId: prev,
      documentId: payload.documentId,
      reason,
      isInitialOpenAfterAppStart,
      incomingViewport: payload.metadata?.viewport ?? null,
      cachedViewport: getCachedViewport(payload.documentId),
      effectiveViewport,
    })
    if (effectiveViewport) {
      cacheViewportForDocument(payload.documentId, effectiveViewport)
    } else {
      // 若无任何来源，则回到默认值（只影响内存，不会强行写后端）
      currentViewport.value = { x: 0, y: 0, scale: 1 }
    }

    // 中文说明：
    // - 让 MindMap 实例在 applyContent/init 前就拿到 documentId，避免 lifecycle:structureReady 丢 docId
    if (mind.value) {
      mind.value.documentId = payload.documentId
      mind.value.bus.fire('lifecycle:documentReady', {
        documentId: payload.documentId,
        reason,
        timestamp: Date.now(),
      })
    }
    loadContent(payload.content, {
      reason,
      viewport: effectiveViewport,
      initialOpen: isInitialOpenAfterAppStart,
    });
  }

  function loadContent(
    content: MindMapData,
    options: {
      reason: 'open' | 'reload' | 'switch'
      viewport?: MindMapViewport | null
      initialOpen?: boolean
    }
  ) {
    if (!mind.value) {
      pendingContent.value = content;
      pendingApplyOptions.value = options
      return;
    }
    applyContent(mind.value, content, options);
    pendingContent.value = null;
  }

  function getViewportSnapshot(): MindMapViewport {
    if (!mind.value || !mind.value.map) {
      // mind 实例不存在（典型：页面已卸载）时，优先从内存缓存恢复
      const docId = currentDocumentId.value
      if (docId) {
        const cached = getCachedViewport(docId)
        if (cached) return cached
      }
      return documentMetadata.value?.viewport ?? currentViewport.value ?? { x: 0, y: 0, scale: 1 };
    }
    const transform = mind.value.map.style.transform || 'translate(0px, 0px) scale(1)';
    const { x, y } = getTranslate(transform);
    return {
      x,
      y,
      scale: mind.value.scaleVal ?? 1,
    };
  }

  function countNodes(node: NodeObj | null | undefined): number {
    if (!node) return 0;
    let total = 1;
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        total += countNodes(child);
      }
    }
    return total;
  }

  function getSerializableState() {
    const content = mind.value ? mind.value.getData() : pendingContent.value;
    if (!content) {
      return null;
    }
    // 中文说明：theme 可能是 string（旧数据）或对象（Theme），这里做严格的类型收敛，禁止 any 断言
    const themeName = (() => {
      const t = content.theme
      if (typeof t === 'string') return t
      if (!t || typeof t !== 'object') return null
      if (!('name' in t)) return null
      const name = (t as { name?: unknown }).name
      return typeof name === 'string' ? name : null
    })()
    const metadata: MindMapMetadata = {
      rootTopic: content.nodeData?.topic || null,
      themeName,
      layoutType: content.direction ?? null,
      nodeCount: countNodes(content.nodeData),
      viewport: getViewportSnapshot(),
      createdAt: documentMetadata.value?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    return { content, metadata };
  }

  function syncState() {
    if (!mind.value) return;
    const m = mind.value;

    // 同步基础状态
    currentNodes.value = [...(m.currentNodes || [])];
    scale.value = m.scaleVal;
    direction.value = m.direction;
    isFocusMode.value = m.isFocusMode;
  }

  function resetState() {
    currentNodes.value = [];
    scale.value = 1;
    direction.value = null;
    isFocusMode.value = false;
    isEditingInput.value = false;
    moveMode.value = false;
  }

  function closeDocumentSession(documentId: string) {
    if (currentDocumentId.value !== documentId) return;

    // 中文说明：关闭会话时只清理 MindMap 的文档运行态；
    // 真实 DOM/engine 实例销毁仍由 MindMapView 的 Vue 生命周期负责，避免 handler 反向操作视图。
    captureViewportSnapshot();
    currentDocumentId.value = null;
    currentDocumentName.value = '未命名思维导图';
    documentMetadata.value = null;
    pendingContent.value = null;
    pendingApplyOptions.value = null;
    isMindMapReady.value = false;
    resetState();
  }

  // 专门用于事件回调的更新方法
  function updateSelection(nodes: Topic[]) {
    currentNodes.value = [...nodes];
  }

  function updateScale(newScale: number) {
    scale.value = newScale;
    // 中文说明：缩放会同时改变 translate（围绕 offset 缩放），因此必须重新采集 viewport
    captureViewportSnapshot()
  }

  function updateViewportByMove(delta: { dx: number; dy: number }) {
    if (!currentDocumentId.value) return
    if (!canWriteViewportCache()) {
      viewportLog('updateViewportByMove ignored (instance not applied yet)', {
        currentDocumentId: currentDocumentId.value,
        delta,
        mindDocumentId: mind.value?.documentId ?? null,
        appliedDocumentId: mind.value ? appliedDocumentIdByInstance.get(mind.value) : null,
      })
      return
    }
    const prev = currentViewport.value
    const next: MindMapViewport = {
      x: prev.x + delta.dx,
      y: prev.y + delta.dy,
      // scale 以实例为准（若实例已卸载则保留 prev）
      scale: mind.value?.scaleVal ?? prev.scale ?? 1,
    }
    cacheViewportForDocument(currentDocumentId.value, next)
    if (mind.value) {
      updateViewportAnchorCache(currentDocumentId.value, mind.value, next)
    }
    viewportLog('updateViewportByMove', {
      documentId: currentDocumentId.value,
      delta,
      viewport: next,
    })
  }

  function updateDirection(newDir: number) {
    direction.value = newDir;
  }

  function setIsEditingInput(editing: boolean) {
    isEditingInput.value = editing;
  }

  function setMoveMode(enabled: boolean) {
    moveMode.value = enabled;
    if (mind.value) {
      mind.value.moveMode = enabled;
    }
  }

  function registerCustomHotkey(key: string, handler: (e: KeyboardEvent) => void, enabled = true) {
    hotkeyConfig.value = {
      ...hotkeyConfig.value,
      [key]: { handler, enabled },
    };
  }

  function disableHotkey(key: string) {
    const existing = hotkeyConfig.value[key] || {};
    hotkeyConfig.value = {
      ...hotkeyConfig.value,
      [key]: {
        ...existing,
        enabled: false,
      },
    };
  }

  function enableHotkey(key: string) {
    const existing = hotkeyConfig.value[key];
    if (existing) {
      hotkeyConfig.value = {
        ...hotkeyConfig.value,
        [key]: {
          ...existing,
          enabled: true,
        },
      };
    } else {
      hotkeyConfig.value = {
        ...hotkeyConfig.value,
        [key]: { enabled: true },
      };
    }
  }

  function removeHotkeyOverride(key: string) {
    if (!(key in hotkeyConfig.value)) return;
    const { [key]: _removed, ...rest } = hotkeyConfig.value;
    hotkeyConfig.value = rest;
  }

  function resetHotkeyConfig() {
    hotkeyConfig.value = {};
  }

  return {
    // State
    mind,
    currentNodes,
    scale,
    direction,
    isFocusMode,
    isEditingInput,
    hotkeyConfig,
    moveMode,
    currentDocumentId,
    currentDocumentName,
    documentMetadata,
    isApplyingDocument,
    currentViewport,
    isMindMapReady,

    // Getters
    currentNode,
    hasSelection,
    isRootSelected,

    // Actions
    setMind,
    setDocumentSession,
    loadContent,
    getViewportSnapshot,
    getSerializableState,
    closeDocumentSession,
    syncState,
    resetState,
    updateSelection,
    updateScale,
    updateViewportByMove,
    captureViewportSnapshot,
    updateDirection,
    setIsEditingInput,
    setMoveMode,
    registerCustomHotkey,
    disableHotkey,
    enableHotkey,
    removeHotkeyOverride,
    resetHotkeyConfig,
  };
});

registerMindMapAdapter({
  setDocumentSession(payload) {
    const store = useMindMapStore();
    store.setDocumentSession(payload);
  },
  getSerializableState() {
    const store = useMindMapStore();
    return store.getSerializableState();
  },
  closeDocumentSession(documentId) {
    const store = useMindMapStore();
    store.closeDocumentSession(documentId);
  },
});
