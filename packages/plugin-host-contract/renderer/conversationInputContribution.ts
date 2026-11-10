import type { Component } from 'vue';

/** 创建 composer 引用所需的宿主无关输入。引用 id 由宿主在真正入栈时生成。 */
export interface ConversationReferenceInput {
  /** 仅composer内同owner/kind去重，移除或发送后可再次加入。 */
  readonly deduplicationKey?: string;
  readonly text: string;
  readonly previewText?: string;
  readonly source?: Record<string, unknown>;
  readonly pluginId?: string;
  readonly kind?: string;
  readonly uri?: string;
  readonly label?: string;
  readonly metadata?: Record<string, unknown>;
}

/** ReferenceProvider 返回的轻量候选；候选本身不承载最终引用内容。 */
export interface ConversationReferenceCandidate {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: Component;
  readonly score?: number;
}

/**
 * composer 候选源贡献。
 *
 * query 只负责发现候选；resolveReference 在用户确认后才构造引用，避免候选查询
 * 提前读取正文或绑定 conversation 内部状态。
 */
export interface ConversationReferenceProviderContribution {
  readonly pluginId: string;
  readonly id: string;
  readonly triggerChar?: string;
  readonly priority?: number;
  readonly query: (input: {
    readonly keyword: string;
    readonly limit?: number;
  }) => Promise<ConversationReferenceCandidate[]>;
  readonly resolveReference: (
    candidate: ConversationReferenceCandidate,
  ) => ConversationReferenceInput;
  readonly isAvailable?: () => boolean;
}

/**
 * Composer 引用的宿主无关展示输入。
 *
 * 这里只暴露标准 pill 真正需要的数据，避免公共契约依赖 conversation 内部类型。
 */
export interface ConversationReferenceChipInput {
  readonly id: string;
  readonly pluginId: string;
  readonly kind: string;
  readonly uri?: string;
  readonly label: string;
  readonly previewText: string;
  readonly text: string;
  readonly source?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationReferenceChipDescriptor {
  readonly label: (reference: ConversationReferenceChipInput) => string;
  readonly preview: (reference: ConversationReferenceChipInput) => string;
  /**
   * 引用的是一个对象（如文档）时给出它的类型图标，与文件树同一图标。
   * 声明后输入框标签带图标，已发送消息里也按标签显示；选中文字这类正文引用不声明，历史中仍是引用块。
   */
  readonly icon?: (reference: ConversationReferenceChipInput) => Component;
}

/**
 * 一个插件内的引用类型贡献。
 *
 * 标准 pill 展示、校验及显式点击动作；动态正文只在发送准备阶段解析一次。
 */
export interface ConversationReferencePreparationContext {
  readonly projectId: string | null;
  readonly conversationId: string | null;
  readonly signal: AbortSignal;
}

/** 已确认发送的正文快照；owner/kind/id 不允许刷新 provider 改写。 */
export type ConversationReferencePreparedContent = Omit<ConversationReferenceInput, 'pluginId' | 'kind'>;

export interface ConversationReferenceKindContribution {
  readonly pluginId: string;
  readonly kind: string;
  readonly chip: ConversationReferenceChipDescriptor;
  /** 悬停时才挂载，只读；接收reference标准DTO，关闭/移除后卸载。 */
  readonly previewComponent?: Component;
  /** false 时胶囊不弹悬停预览：引用文字已说清来源、弹层只会遮挡输入框时使用；点击仍交给 onActivate。 */
  readonly hoverPreview?: false;
  readonly isValid?: (reference: ConversationReferenceChipInput) => boolean;
  readonly isAvailable?: () => boolean;
  /** 发送前由 Host 等待；失败保留草稿，成功结果冻结进本次消息。 */
  readonly prepareForSend?: (
    reference: ConversationReferenceChipInput,
    context: ConversationReferencePreparationContext,
  ) => Promise<ConversationReferencePreparedContent>;
  readonly onActivate?: (reference: ConversationReferenceChipInput) => void | Promise<void>;
}

/** Accessory 经宿主绑定 owner 后可新增的引用，不允许组件冒用其他插件身份。 */
export type ConversationInputAccessoryReferenceInput = Omit<
  ConversationReferenceInput,
  'pluginId'
> & {
  readonly kind: string;
};

/** Accessory 只能通过这组窄命令操作 composer 引用，不接触编辑器实例或提交链。 */
export interface ConversationInputAccessoryComposerCommands {
  addReference(input: ConversationInputAccessoryReferenceInput): string;
  removeReference(referenceId: string): void;
}

export interface ConversationInputAccessoryProps {
  readonly composer: ConversationInputAccessoryComposerCommands;
  readonly disabled: boolean;
}

/**
 * 运行期可装卸的 composer 附加操作区。
 *
 * 组件自行读取插件内部的 selection/store；宿主只负责挂载和注入 owner-bound
 * composer 命令。Accessory 不接管 submit，不改变 TipTap schema。
 */
export interface ConversationInputAccessoryContribution {
  readonly pluginId: string;
  readonly id: string;
  readonly component: Component<ConversationInputAccessoryProps>;
  readonly isVisible?: () => boolean;
}

/**
 * 插件可声明的 conversation 输入贡献。
 *
 * 只开放运行期可注册的引用类型、候选源与叠加操作区。会改变编辑器 schema 或
 * 接管提交的输入扩展属于宿主构造期能力，不进入插件契约。
 */
export interface PluginConversationInputContribution {
  readonly referenceKinds: readonly ConversationReferenceKindContribution[];
  readonly referenceProviders: readonly ConversationReferenceProviderContribution[];
  readonly accessories?: readonly ConversationInputAccessoryContribution[];
}
