/**
 * 行为追踪类型定义
 * 用于记录用户编辑行为，支持意图预测
 */

/**
 * 编辑事件类型
 */
export type BehaviorEventType =
  | 'insert'             // 输入（键入/IME 提交）
  | 'delete'             // 删除（回删/范围删除）
  | 'paste'              // 粘贴
  | 'selection_move'     // 选区变化（方向键/鼠标点击）
  | 'undo'               // 撤销
  | 'redo'               // 重做
  | 'accept_suggestion'  // 接受补全（Tab）

/**
 * 事件来源
 */
export type BehaviorEventSource =
  | 'keyboard'  // 键盘输入
  | 'mouse'     // 鼠标操作
  | 'command'   // 命令触发
  | 'unknown'   // 未知来源

/**
 * 单个行为事件记录
 */
export interface BehaviorEvent {
  /** 事件类型 */
  type: BehaviorEventType

  /** 时间戳（毫秒） */
  ts: number

  /** 文档起始位置 */
  from: number

  /** 文档结束位置 */
  to: number

  /** 字符增量（正=插入，负=删除） */
  deltaChars: number

  /**
   * 极短内容样本（可选，严格截断）
   * 用于区分"改错"与"重写/改结构"
   * 建议最大长度：30-80 字符
   */
  contentSample?: string

  /** 事件来源（可选） */
  source?: BehaviorEventSource
}

/**
 * 行为窗口配置
 */
export interface BehaviorWindowConfig {
  /** 时间窗口（毫秒），默认 60 秒 */
  timeWindowMs?: number

  /** 最大事件数量，默认 100 */
  maxEvents?: number

  /** 内容样本最大长度，默认 50 字符 */
  maxContentSampleLength?: number

  /** 自动过期清理间隔（毫秒），默认 10 秒 */
  cleanupIntervalMs?: number
}

/**
 * 行为窗口统计摘要
 */
export interface BehaviorSummary {
  /** 时间窗口内的总事件数 */
  totalEvents: number

  /** 各类型事件的计数 */
  eventCounts: Record<BehaviorEventType, number>

  /** 总插入字符数 */
  totalInsertedChars: number

  /** 总删除字符数（绝对值） */
  totalDeletedChars: number

  /** 最近一次事件的时间戳 */
  lastEventTs: number | null

  /** 窗口起始时间戳 */
  windowStartTs: number

  /** 窗口结束时间戳 */
  windowEndTs: number
}

/**
 * 节奏特征（用于特征提取）
 */
export interface TypingRhythmFeatures {
  /** 平均打字速度（字符/秒） */
  typingSpeedCps: number

  /** 突发输入次数（连续快速输入） */
  burstCount: number

  /** 突发后暂停时间（毫秒） */
  pauseMsAfterBurst: number

  /** 最近一次输入到现在的时间间隔（毫秒） */
  timeSinceLastInput: number
}

/**
 * 操作分布特征
 */
export interface OperationDistribution {
  /** 插入操作占比 (0-1) */
  insertRatio: number

  /** 删除操作占比 (0-1) */
  deleteRatio: number

  /** 粘贴操作占比 (0-1) */
  pasteRatio: number

  /** 选区移动占比 (0-1) */
  selectionMoveRatio: number

  /** 撤销/重做占比 (0-1) */
  undoRedoRatio: number
}

/**
 * 结构编辑特征
 */
export interface StructuralEditingFeatures {
  /** 光标是否在块末尾 */
  cursorAtEndOfBlock: boolean

  /** 后缀是否以分隔符开头（例如 ---、## 等） */
  suffixStartsWithDelimiter: boolean

  /** 刚输入了列表标记（- 、* 、1. 等） */
  justTypedListMarker: boolean

  /** 最近是否有大段删除（超过 100 字符） */
  hasLargeRecentDelete: boolean

  /** 最近删除的字符数 */
  recentDeletedChars: number
}

/**
 * 默认配置常量
 */
export const DEFAULT_BEHAVIOR_WINDOW_CONFIG: Required<BehaviorWindowConfig> = {
  timeWindowMs: 60 * 1000,        // 60 秒
  maxEvents: 100,                  // 最多 100 个事件
  maxContentSampleLength: 50,      // 内容样本最大 50 字符
  cleanupIntervalMs: 10 * 1000,    // 每 10 秒清理一次
}

/**
 * 行为追踪配置常量
 */
export const BEHAVIOR_TRACKING_CONFIG = {
  /** 大段删除的字符数阈值 */
  LARGE_DELETE_THRESHOLD: 100,

  /** 突发输入的时间间隔阈值（毫秒） */
  BURST_INTERVAL_THRESHOLD: 200,

  /** 突发输入的最小事件数 */
  BURST_MIN_EVENTS: 3,

  /** 暂停检测的时间阈值（毫秒） */
  PAUSE_THRESHOLD: 1000,

  /** 列表标记正则表达式 */
  LIST_MARKER_REGEX: /^(\s*[-*+]\s+|\s*\d+\.\s+)/,

  /** 分隔符正则表达式 */
  DELIMITER_REGEX: /^(\s*[-=*]{3,}|\s*#{1,6}\s+)/,
} as const
