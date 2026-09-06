/**
 * Mindmap 插件拥有的 promptKey。
 *
 * 中文说明：
 * - PromptKey 是插件贡献契约，不再要求写进 `@app/schemas` 的全局枚举；
 * - host 侧通过 agent/subagent registry 校验 key 是否已注册，wire schema 只承诺 string；
 * - 这里保留内置 mindmap 的稳定字面量，后续第三方插件也可以用同样方式自带 key。
 */
export const MindmapPromptKeys = {
  SUBAGENT_MINDMAP_EDITOR: 'subagent_mindmap_editor',
} as const;

export type MindmapPromptKey = (typeof MindmapPromptKeys)[keyof typeof MindmapPromptKeys];
