/**
 * @file subrunToolUi.ts
 * @description 渲染端 subrun 卡宿主组件门面。
 *
 * 中文说明：
 * - SubrunCard 依赖 conversation 的完整工具渲染链，比基础图标/控件重很多；
 * - 单独放在这个入口，避免普通插件 UI import `toolUi` 时被迫加载 SubrunCard。
 */

export { default as SubrunCard } from '@/domains/conversation/features/subrun-card/ui/SubrunCard.vue';
export type { HistoricalSubrunTraceLazySource } from '@linnya/plugin-host-contract/renderer/subrunToolUi';
