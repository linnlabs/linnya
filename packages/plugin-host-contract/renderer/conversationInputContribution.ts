import type { Component } from 'vue';

/** 创建 composer 引用所需的宿主无关输入。引用 id 由宿主在真正入栈时生成。 */
export interface ConversationReferenceInput {
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
}

/**
 * 一个插件内的引用类型贡献。
 *
 * 首版只定义宿主标准 pill 已消费的展示与校验能力。点击导航和自定义组件
 * 等到出现真实消费者后再扩展，避免提前背负无实现的兼容契约。
 */
export interface ConversationReferenceKindContribution {
  readonly pluginId: string;
  readonly kind: string;
  readonly chip: ConversationReferenceChipDescriptor;
  readonly isValid?: (reference: ConversationReferenceChipInput) => boolean;
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
