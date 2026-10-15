import type { Node } from '@tiptap/core';

// 保留 JS 实现的公开扩展合同，让剪贴板业务测试使用生产节点而不是另造 schema。
export interface BaseBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const BaseBlock: Node<BaseBlockOptions, Record<string, never>>;
export default BaseBlock;
