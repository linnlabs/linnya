import type { Component } from 'vue';
import type {
  ConversationToolInteraction,
  ConversationToolMessagePhase,
  ConversationToolMessageStatus,
  ConversationAttachmentRef,
  SubrunTraceSummary,
} from '@app/schemas';
import type { MessageParams } from './localization';

export interface ToolTitleConfig {
  readonly text: string;
  readonly tag?: {
    readonly text: string;
    readonly variant?: 'default' | 'success' | 'warning' | 'info';
  };
  readonly documentLink?: {
    readonly prefixText: string;
    readonly text: string;
    readonly documentId: string;
    readonly documentType: string;
    readonly displayName?: string;
    readonly projectId?: string | null;
    readonly parentId?: string | null;
  };
}

/**
 * 工具展示层的延迟本地化文本。
 *
 * 禁止直接保存当前语言字符串：presentation 会随消息跨页面常驻，而语言可以在运行期切换。
 */
export interface ToolLocalizedTextDescriptor {
  readonly key: string;
  readonly fallback: string;
  readonly params?: MessageParams;
}

/** projector 产出的结构化标题；Renderer 在展示时按当前语言解析。 */
export interface ToolTitleDescriptor {
  readonly text: ToolLocalizedTextDescriptor;
  readonly tag?: {
    readonly text: ToolLocalizedTextDescriptor;
    readonly variant?: 'default' | 'success' | 'warning' | 'info';
  };
  readonly documentLink?: {
    readonly prefixText: ToolLocalizedTextDescriptor;
    readonly text: ToolLocalizedTextDescriptor;
    readonly documentId: string;
    readonly documentType: string;
    readonly displayName?: string;
    readonly projectId?: string | null;
    readonly parentId?: string | null;
  };
}

export interface ToolPresentationProjectorInput {
  /** Runtime 事实中的原始工具名；alias 工具必须保留该身份供 wrapper adapter 判别。 */
  readonly sourceToolName: string;
  /** alias 解析后的最终 registry key。 */
  readonly uiKey: string;
  /** 正式 tool_call 身份；交互卡恢复命令只能使用该字段，不能从 metadata 猜测。 */
  readonly toolCallId?: string;
  readonly args: unknown;
  readonly result: unknown;
  /** 已由 Conversation tool metadata schema 判别的交互事实。 */
  readonly interaction?: ConversationToolInteraction;
  /** 父工具行上已经由 Host admission 的轻量 child 身份索引。 */
  readonly subrunSummary?: SubrunTraceSummary;
  readonly status: ConversationToolMessageStatus;
  readonly phase: ConversationToolMessagePhase;
}

/**
 * 宿主已经提交的图片附件事实，供声明了 attachments runtime capability 的工具卡展示。
 * 这是 Renderer 展示合同，不是 Agent 输入 selection，也不包含本地路径或 claim URI。
 */
export type ToolUiImageAttachmentRef = ConversationAttachmentRef;

export interface ToolPresentationProjection<TData = unknown> {
  /**
   * Renderer-only 展示数据。生命周期态只能消费 projector 自己的 lifecycle admission；
   * success 态必须来自工具 owner 的正式参数与结果合同。
   */
  readonly data: TData;
  readonly title?: ToolTitleDescriptor;
  /** 当前已判别状态不需要挂载内容卡片，例如 todo_read 的正式空快照。 */
  readonly hideContent?: boolean;
}

export type ToolPresentationProjector<TData = unknown> = (
  input: ToolPresentationProjectorInput
) => ToolPresentationProjection<TData>;

/**
 * 紧凑工具步骤的 Renderer-only 输入。
 *
 * 它与完整工具卡 presentation 是两个独立展示合同：紧凑步骤不得为了取得标题而运行
 * 完整卡片 projector，也不得把派生结果写入 wire、SQLite 或工具业务结果。
 */
interface ToolCompactStepProjectorInputBase {
  /** Runtime 事实中的原始工具名；alias 工具保留 wrapper 身份。 */
  readonly sourceToolName: string;
  /** alias 解析后的最终 registry key。 */
  readonly uiKey: string;
  /** Subrun 步骤的正式稳定身份。 */
  readonly toolCallId: string;
  readonly args: unknown;
  readonly result: unknown;
}

/**
 * compact projector 的正式生命周期联合。
 * success 才代表可读取成功结果；loading/error 只能做 owner-owned lifecycle admission。
 */
export type ToolCompactStepProjectorInput =
  | ToolCompactStepProjectorInputBase & {
      readonly status: Extract<ConversationToolMessageStatus, 'loading'>;
      readonly phase: Extract<ConversationToolMessagePhase, 'start' | 'update'>;
    }
  | ToolCompactStepProjectorInputBase & {
      readonly status: Extract<ConversationToolMessageStatus, 'success'>;
      readonly phase: Extract<ConversationToolMessagePhase, 'complete'>;
    }
  | ToolCompactStepProjectorInputBase & {
      readonly status: Extract<ConversationToolMessageStatus, 'error'>;
      readonly phase: Extract<ConversationToolMessagePhase, 'error'>;
    };

export interface ToolCompactStepPresentation {
  /** 延迟本地化标题；展示时按当前 locale 解析，禁止缓存当前语言字符串。 */
  readonly title: ToolLocalizedTextDescriptor;
}

export type ToolCompactStepProjector = (
  input: ToolCompactStepProjectorInput
) => ToolCompactStepPresentation;

/**
 * Renderer-only 的工具卡派生模型。它不属于 wire/SQLite schema，也不得写入 message.metadata。
 */
export interface ToolCardPresentation<TData = unknown> extends ToolPresentationProjection<TData> {
  readonly uiKey: string;
  readonly status: ConversationToolMessageStatus;
  readonly phase: ConversationToolMessagePhase;
}

export interface ToolUiConfig {
  /** 专用渲染组件；正式工具卡只接收 admission 后的 presentation，不得读取 raw payload。 */
  readonly component: Component;
  /**
   * 标准工具卡标题正文的可选专用组件。
   *
   * 外壳、图标、标签、折叠和交互仍归 Host；只有确实依赖声明式 runtime fact 的动态标题
   * 才使用该入口，静态标题继续由 presentation 提供。注册后，运行态标题视觉也归该组件，
   * Host 不再叠加通用 loading spinner。
   */
  readonly titleComponent?: Component;
  /**
   * 工具 payload 的唯一展示解释器。
   *
   * Host 会在 admission 边界先完成 alias 解析，再调用该函数。wrapper adapter、strict
   * schema parse 与展示模型构造必须在这一次调用内完成，组件不得重新读取原始 args/result。
   * loading/error 分支不得解析仅 success 才存在的 payload。
   */
  readonly presentation?: ToolPresentationProjector;
  /**
   * 紧凑执行步骤的唯一展示解释器。
   *
   * Host 在非响应式 admission 边界完成 alias 解析后调用。工具参数、结果与业务动作只能由
   * 当前工具 owner 解释；Conversation 和 Vue 组件不得维护第二份工具名映射。
   */
  readonly compactStep?: ToolCompactStepProjector;
  /** Renderer 工具图标必须是已注册组件，禁止用无 owner 的字符串名称做运行期猜测。 */
  readonly icon?: Component;
  /**
   * 卡片需要 Host 提供的运行期能力。能力必须逐项声明，禁止扩张为万能 runtime context。
   * subrun trace 属于 Conversation 运行态/历史回放事实，不得写入 presentation。
   */
  readonly runtime?: {
    readonly subrunTrace?: true;
    /** 只用于确实需要按消息所属 conversation scope 读取历史资源的卡片。 */
    readonly conversationId?: true;
    /** 只用于展示已由 Host durable event 携带的图片附件。 */
    readonly attachments?: true;
  };
  readonly layout?: {
    /** 是否默认折叠；函数形式仅用于基于工具参数决定初始状态。 */
    readonly defaultCollapsed?: boolean | ((args: unknown) => boolean);
    readonly hideBorder?: boolean;
    readonly hideBackground?: boolean;
    readonly noPadding?: boolean;
    readonly fullWidth?: boolean;
    readonly disableHeaderHover?: boolean;
    readonly hideContent?: boolean;
    readonly overflowVisible?: boolean;
    readonly renderAsGroup?: boolean;
  };
}

export interface ToolUiAliasConfig {
  /** 将统一工具名解析为最终 UI key；alias 不允许继续指向 alias。 */
  readonly resolveUiKey: (args: unknown, result?: unknown) => string | null;
}

export type ToolUiEntry = ToolUiConfig | ToolUiAliasConfig;
