import type { Component } from 'vue';
import type { AnyExtension } from '@tiptap/core';
import type { ConversationReferenceChipInput } from '@linnya/plugin-host-contract/renderer';

/** 宿主可追踪的只读 selector，不向内部契约泄漏 Vue Ref 或 Pinia store。 */
export interface ConversationInputReadonlySelector<T> {
  readonly value: T;
}

export type ConversationInputInlineTokenAttribute = string | number | boolean | null;

/** 宿主可插入的通用 inline token；具体 type 与 attributes 由内置扩展解释。 */
export interface ConversationInputInlineToken {
  readonly type: string;
  readonly attributes: Readonly<Record<string, ConversationInputInlineTokenAttribute>>;
}

/** 上下文条只能通过这组窄动词操作它所属的 composer 实例。 */
export interface ConversationInputComposerHandles {
  insertInlineToken(token: ConversationInputInlineToken): boolean;
}

export interface ConversationInputContextBarHandles {
  readonly composer: ConversationInputComposerHandles;
  deactivate(): void | Promise<void>;
}

/** 上下文条组件只能读取 opaque payload，并通过宿主句柄请求退出。 */
export interface ConversationInputContextBarProps {
  readonly payload: unknown;
  readonly handles: ConversationInputContextBarHandles;
}

export interface ConversationInputContextBarDescriptor {
  readonly component: Component<ConversationInputContextBarProps>;
  readonly payload: ConversationInputReadonlySelector<unknown>;
}

/** 输入编辑器的构造期静态扩展；运行期插件不能贡献此能力。 */
export interface ConversationInputEditorExtensionDescriptor {
  readonly id: string;
  readonly create: () => AnyExtension;
}

export interface ConversationInputExtensionSubmitPayload {
  readonly text: string;
  readonly references: readonly ConversationReferenceChipInput[];
}

export type ConversationInputExtensionExecutionStatus = 'idle' | 'running';

export interface ConversationInputExtensionExecutionState {
  readonly status: ConversationInputReadonlySelector<ConversationInputExtensionExecutionStatus>;
  readonly cancel: () => void;
}

/**
 * Composer 宿主内部的完整输入扩展契约。
 *
 * 它包含 TipTap 构造期能力，只允许 app builtin 装配；插件 SDK 只公开
 * PluginConversationInputContribution 的运行期 Reference 能力。
 */
export interface HostConversationInputExtension {
  readonly id: string;
  readonly isActive: ConversationInputReadonlySelector<boolean>;
  /** 扩展必须显式声明是否会消费 onSubmit payload 中的外置 references。 */
  readonly acceptsReferences: boolean;
  /** 扩展必须显式声明是否会消费图片附件；当前内建扩展均不接受。 */
  readonly acceptsAttachments: boolean;
  readonly contextBar: ConversationInputContextBarDescriptor;
  readonly editorExtensions: readonly ConversationInputEditorExtensionDescriptor[];
  /** 激活扩展自行解释纯文本变化；宿主不解析扩展语义。 */
  readonly onTextChange?: (text: string) => void;
  readonly onSubmit: (payload: ConversationInputExtensionSubmitPayload) => void | Promise<void>;
  readonly onDeactivate: () => void | Promise<void>;
  readonly executionState: ConversationInputExtensionExecutionState;
}

export interface ConversationInputChatExecutionSource {
  readonly isLoading: () => boolean;
  readonly isStreaming: () => boolean;
  readonly cancel: () => void;
}

export interface ResolvedConversationInputExecution {
  readonly isLoading: boolean;
  readonly isStreaming: boolean;
  readonly cancel: () => void;
}
