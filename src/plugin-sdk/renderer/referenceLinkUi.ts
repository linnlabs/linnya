/**
 * @file referenceLinkUi.ts
 * @description 渲染端工作区引用链接宿主组件门面。
 *
 * 中文说明：
 * - WorkspaceRefLink 会读取 host 文件状态并处理跨 surface 跳转；
 * - 单独放在这个入口，避免基础图标/控件 import `toolUi` 时拉起 workspace store。
 */

export { default as WorkspaceRefLink } from '@/domains/conversation/ui/tools/shared/WorkspaceRefLink.vue';
