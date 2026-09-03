import type { Topic, CustomSvg, Expander } from './dom'
import type { createBus, EventMap, Operation } from '../../shared/utils/events/eventBus'
import type { MindMapMethods, OperationMap, Operations } from '../core/methods'
import type { LinkDragMoveHelperInstance } from '../../shared/utils/dragDrop/LinkDragMoveHelper'
import type { Arrow } from '../../presentation/render/arrow'
import type { Summary, SummarySvgGroup } from '../../presentation/render/summary'
import type { MainLineParams, SubLineParams } from '../../shared/utils/layout/generateBranch'
import type { createDragMoveHelper } from '../../shared/utils/dragDrop/dragMoveHelper'
import type SelectionArea from '../../interaction/selection/core'
import type { ReflowReason, ReflowScheduler } from '../../shared/utils/reflow'
import type { MindMapCommands, MindMapCan, RunCommand } from '../commands/types'
export { type MindMapMethods } from '../core/methods'

export const DirectionClass = {
  LEFT: 'lhs',
  RIGHT: 'rhs',
} as const

export type DirectionClass = (typeof DirectionClass)[keyof typeof DirectionClass]

type Before = Partial<{
  [K in Operations]: (...args: Parameters<OperationMap[K]>) => Promise<boolean> | boolean
}>

/**
 * MindMap Theme
 *
 * @public
 */
export type Theme = {
  name: string
  /**
   * Hint for developers to use the correct theme
   */
  type?: 'light' | 'dark'
  /**
   * Color palette for main branches
   */
  palette: string[]
  cssVar: {
    '--node-gap-x': string
    '--node-gap-y': string
    '--main-gap-x': string
    '--main-gap-y': string
    '--main-color': string
    '--main-bgcolor': string
    '--color': string
    '--bgcolor': string
    '--selected': string
    '--accent-color': string
    '--root-color': string
    '--root-bgcolor': string
    '--root-border-color': string
    '--root-radius': string
    '--main-radius': string
    '--topic-padding': string
    '--topic-radius': string
    '--panel-color': string
    '--panel-bgcolor': string
    '--panel-border-color': string
    '--map-padding': string
    '--expander-color': string
    '--mindmap-svg-label-color': string
    '--mindmap-svg-path-stroke': string
    '--mindmap-link-controller-stroke': string
    '--mindmap-arrow-stroke': string
    '--mindmap-arrow-label-color': string
  }
}

export type Alignment = 'root' | 'nodes'

export interface KeypressOptions {
  [key: string]: (e: KeyboardEvent) => void
}

export type MindMapHistoryResetReason = 'document-session-applied'

/**
 * The MindMap instance
 *
 * @public
 */
export interface MindMapInstance
  extends Omit<Required<Options>, 'markdown' | 'imageProxy' | 'renderers' | 'expanderRenderer'>,
    MindMapMethods {
  /**
   * 当前 MindMap 绑定的 documentId（来自 workspace 文档会话）
   *
   * 中文说明：
   * - 这是“文档上下文”的唯一业务 ID（与 DOM 的 `me${id}` 无关）
   * - 用于 lifecycle 信号、feature 初始化、IPC 入参等跨层一致性
   * - 初始可能为 null（例如 MindMap 实例刚创建但文档还未加载）
   */
  documentId: string | null

  /**
   * 结构修订号（单文档内自增）
   *
   * 中文说明：
   * - 每次 `init/refresh` 等结构重建完成后自增
   * - 用于诊断“结构变化”与“几何 flush”是否匹配（避免过期重算）
   */
  structureRevision: number

  markdown?: (markdown: string, obj: NodeObj | Arrow | Summary) => string // Keep markdown as optional
  imageProxy?: (url: string) => string // Keep imageProxy as optional
  dragged: Topic[] | null // currently dragged nodes
  spacePressed: boolean // space key pressed state
  moveMode: boolean // view move mode state
  el: HTMLElement
  disposable: Array<() => void>
  isFocusMode: boolean
  nodeDataBackup: NodeObj

  nodeData: NodeObj
  arrows: Arrow[]
  summaries: Summary[]

  readonly currentNode: Topic | null
  currentNodes: Topic[]
  currentSummary: SummarySvgGroup | null
  currentArrow: CustomSvg | null
  waitCopy: Topic[] | null

  scaleVal: number
  tempDirection: 0 | 1 | 2 | null

  container: HTMLElement
  map: HTMLElement
  root: HTMLElement
  nodes: HTMLElement
  lines: SVGElement
  summarySvg: SVGElement
  linkController: SVGElement
  labelContainer: HTMLElement // Container for SVG labels
  P2: HTMLElement
  P3: HTMLElement
  line1: SVGElement
  line2: SVGElement
  linkSvgGroup: SVGElement
  /**
   * @internal
   */
  helper1?: LinkDragMoveHelperInstance
  /**
   * @internal
   */
  helper2?: LinkDragMoveHelperInstance

  bus: ReturnType<typeof createBus>
  history: Operation[]
  undo: () => void
  redo: () => void
  /**
   * 重置撤销历史的基准快照。
   *
   * 中文说明：
   * - 文档打开/切换/重载属于“加载外部事实”，不应该进入 undo 栈；
   * - operationHistory 插件安装后提供该窄口子，由文档会话 apply 完成后调用；
   * - 普通 refresh（例如 undo/redo 内部重建 DOM）禁止调用，否则会破坏 redo 语义。
   */
  resetHistoryBaseline?: (reason: MindMapHistoryResetReason) => void

  selection?: SelectionArea
  dragMoveHelper: ReturnType<typeof createDragMoveHelper>
  renderers: MindMapRenderers

  /**
   * ReflowScheduler 实例（内部使用）
   *
   * 中文说明：
   * - 由 MindMapEngine 在 mount 时安装
   * - UI/feature 不应直接访问，而是通过 requestReflow() 方法
   */
  reflowScheduler?: ReflowScheduler

  /**
   * 请求重算连线/布局（统一入口）
   *
   * 中文说明：
   * - 这是 UI/feature 触发重算的唯一推荐方式
   * - 内部使用 rAF 合并同帧请求，避免抖动/卡顿
   * - 禁止 UI/feature 直接调用 layout()（会破坏选中状态/Teleport）
   *
   * @param reason 重算原因（用于日志追踪与调试）
   */
  requestReflow(reason: ReflowReason): void

  /**
   * 强时序立即重算（白名单点位专用）
   *
   * 中文说明：
   * - 仅允许内核/交互白名单点位调用（见 `docs/MINDMAP_DEV_GUIDE.md`）
   * - 主要用于 init/refresh/nodeExpansion 这类必须同步拿到最新几何的流程
   * - 调用后仍然会发出 `lifecycle:geometryFlushed`，保证观测链路不断
   *
   * @param reason 重算原因（用于日志追踪与调试）
   */
  requestReflowNow(reason: ReflowReason): void

  // =========================================================================
  // 命令体系（Phase 1 新增）
  // =========================================================================

  /**
   * 命令 API（唯一允许产生副作用的入口）
   *
   * 中文说明：
   * - UI/interaction/feature 应通过 mind.commands.* 触发操作
   * - 命令内部做参数归一化、guard 检查、可观测日志
   * - 由 installMindMapCommands() 安装
   */
  commands: MindMapCommands

  /**
   * can API（纯检查，无副作用）
   *
   * 中文说明：
   * - 用于 UI 决策（如菜单项是否可用）
   * - 禁止 DOM 操作、store 写入、IPC 调用
   * - 由 installMindMapCommands() 安装
   */
  can: MindMapCan

  /**
   * 统一命令执行入口
   *
   * 中文说明：
   * - 底层 runner，mind.commands.* 内部调用此方法
   * - 一般不直接使用，除非需要动态命令名
   * - 由 installMindMapCommands() 安装
   */
  runCommand: RunCommand

  // -------------------------------------------------------------------------
  // 内部运行态开关（不对外暴露能力）
  // -------------------------------------------------------------------------
  /**
   * @internal
   *
   * 中文说明：
   * - `init()` 默认会在末尾调用 `toCenter()`，用于首屏把根节点居中；
   * - 但在“需要恢复 viewport”的场景（例如切回页面回到上次浏览位置），
   *   这次 toCenter 会造成肉眼可见的闪烁（先居中，再被外部 transform 拉回）；
   * - 因此提供一次性开关：当为 true 时，`init()` 会跳过那一次 `toCenter()`，并在执行后自动清除。
   */
  __skipToCenterOnce?: boolean
}
type PathString = string
/**
 * The MindMap options
 *
 * @public
 */
export interface Options {
  el: string | HTMLElement
  direction?: 0 | 1 | 2
  locale?: string
  draggable?: boolean
  editable?: boolean
  contextMenu?: boolean
  toolBar?: boolean
  keypress?: boolean | KeypressOptions
  mouseSelectionButton?: 0 | 2
  before?: Before
  newTopicName?: string
  allowUndo?: boolean
  overflowHidden?: boolean
  generateMainBranch?: (this: MindMapInstance, params: MainLineParams) => PathString
  generateSubBranch?: (this: MindMapInstance, params: SubLineParams) => PathString
  theme?: Theme
  selectionContainer?: string | HTMLElement
  alignment?: Alignment
  scaleSensitivity?: number
  scaleMin?: number
  scaleMax?: number
  handleWheel?: true | ((e: WheelEvent) => void)
  /**
   * Custom markdown parser function that takes markdown string and returns HTML string
   * If not provided, markdown will be disabled
   * @default undefined
   */
  markdown?: (markdown: string, obj: NodeObj | Arrow | Summary) => string
  /**
   * Image proxy function to handle image URLs, mainly used to solve CORS issues
   * If provided, all image URLs will be processed through this function before setting to img src
   * @default undefined
   */
  imageProxy?: (url: string) => string
  renderers?: Partial<MindMapRenderers>
  expanderRenderer?: ExpanderRenderer
}

export type ExpanderRendererContext = {
  mind: MindMapInstance
  node: NodeObj
  expanded: boolean
}

export type ExpanderRenderer = (ctx: ExpanderRendererContext) => Expander

export type MindMapRenderers = {
  expander: ExpanderRenderer
}

export type Uid = string

export type Left = 0
export type Right = 1

/**
 * Tag object for node tags with optional styling
 *
 * @public
 */
export interface TagObj {
  text: string
  style?: Partial<CSSStyleDeclaration> | Record<string, string>
  className?: string
}

export type RichContentDescriptor =
  | {
      type: 'katex'
      value: string
    }
  | {
      type: 'code'
      value: string
      language?: string
    }
  | {
      type: 'html'
      value: string
    }

/**
 * 节点打标信息（推理语义）
 *
 * 中文说明：
 * - 存在于 Spine：`mindmap_versions.content_json` 中的 NodeObj
 * - 用于状态呈现与可解释入口（Refuted 感叹号）
 * - 可扩展：未来允许新增更多标签键（例如 blocked / risk_level / owner 等）
 *
 * @see packages/plugins/mindmap/src/renderer/docs/README.md
 */
export type NodeTagging = {
  /**
   * 节点状态
   *
   * 推荐值（存储使用小写）：
   * - 'open'：待验证（默认）
   * - 'verified'：已证实
   * - 'refuted'：已证伪/驳斥
   * - 'closed'：无关/关闭
   *
   * 规范：
   * - 存储值使用小写（open/verified/...），避免大小写漂移
   * - UI 展示文案由前端映射（Open/已证实/已证伪/关闭）
   * - 允许扩展：工具可写入未知值，UI 需有兜底呈现
   */
  status?: string

  /**
   * 置信度
   *
   * 推荐值：
   * - 'high'：高置信度
   * - 'medium'：中等置信度
   * - 'low'：低置信度
   *
   * 扩展策略：
   * - 允许 string：high/medium/low 或未来更多分级
   * - 允许 number：例如 0..1 或 0..100（当需要量化时）
   */
  confidence?: string | number

  /**
   * 扩展标签（可选）
   *
   * - key：稳定语义键（建议 snake_case）
   * - value：原子值，避免嵌套对象造成协议复杂化
   *
   * 示例：
   * - { owner: 'alice', risk_level: 'high', blocked: true }
   */
  labels?: Record<string, string | number | boolean>
}

/**
 * MindMap node object
 *
 * @public
 */
export interface NodeObj {
  topic: string
  id: Uid
  richContent?: RichContentDescriptor
  style?: Partial<{
    fontSize: string
    fontFamily: string
    color: string
    background: string
    fontWeight: string
    width: string
    border: string
    textDecoration: string
  }>
  children?: NodeObj[]
  tags?: (string | TagObj)[]
  icons?: string[]
  hyperLink?: string
  expanded?: boolean
  direction?: Left | Right
  image?: {
    url: string
    width: number
    height: number
    fit?: 'fill' | 'contain' | 'cover'
  }
  /**
   * The color of the branch.
   */
  branchColor?: string
  /**
   * This property is added programatically, do not set it manually.
   *
   * the Root node has no parent!
   */
  parent?: NodeObj
  /**
   * Render custom HTML in the node.
   *
   * Everything in the node will be replaced by this property.
   */
  dangerouslySetInnerHTML?: string
  /**
   * Extra data for the node, which can be used to store any custom data.
   */
  note?: string
  // TODO: checkbox
  // checkbox?: boolean | undefined

  /**
   * 节点打标信息（AI 推理/验证语义）
   *
   * 中文说明：
   * - 用于 Issue Tree 场景下的假设验证、状态标记、置信度评估
   * - 由 AI 工具（workspace_tag_mindmap）写入
   * - 前端根据 tagging.status 展示视觉反馈（如 Refuted 变灰 + 感叹号）
   *
   * @see NodeTagging
   * @see packages/plugins/mindmap/src/renderer/docs/README.md
   */
  tagging?: NodeTagging
}
export type NodeObjExport = Omit<NodeObj, 'parent'>

/**
 * The exported data of MindMap
 *
 * @public
 */
export type MindMapData = {
  nodeData: NodeObj
  arrows?: Arrow[]
  summaries?: Summary[]
  direction?: 0 | 1 | 2
  theme?: Theme
}
