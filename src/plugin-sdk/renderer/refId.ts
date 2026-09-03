/**
 * @file refId.ts
 * @description 渲染端 refId 协议门面。
 *
 * 中文说明：
 * - 插件前端上下文与工具卡需要复用 host 的 refId 协议；
 * - 通过 SDK 暴露协议入口，避免插件包直接 import shared/utils。
 */

export {
  generateRefMap,
  isValidRef,
  normalizeRef,
} from '@/shared/utils/refIdGenerator';
