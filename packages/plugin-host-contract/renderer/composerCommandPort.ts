import type { ConversationReferenceInput } from './conversationInputContribution';

/**
 * 插件页面交互新增引用时使用的窄输入。
 *
 * owner 与 kind 必须由调用方显式声明，宿主不会继承平台默认引用身份。
 */
export interface ComposerCommandReferenceInput extends ConversationReferenceInput {
  readonly pluginId: string;
  readonly kind: string;
}

/** 宿主绑定到 conversation composer 的最小命令面。 */
export interface RendererComposerCommandPort {
  /** 返回宿主生成的 id，供调用方精确撤销本次新增。 */
  addReference(input: ComposerCommandReferenceInput): string;
  removeReference(referenceId: string): void;
}

export declare function addComposerReference(input: ComposerCommandReferenceInput): string;
export declare function removeComposerReference(referenceId: string): void;
