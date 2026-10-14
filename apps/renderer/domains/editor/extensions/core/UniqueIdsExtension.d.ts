import type { Extension } from '@tiptap/core';
import type { PluginKey } from '@tiptap/pm/state';

// 跨 Renderer/Markdown 的业务测试需要此 JS 扩展的公开类型；不改变身份修复规则。
export const ensureUniqueIdsPluginKey: PluginKey<undefined>;
export const UniqueIdsExtension: Extension<Record<string, never>, Record<string, never>>;
export default UniqueIdsExtension;
