// apps/renderer/shared/menus/blockActionMenu/index.ts
/**
 * 块操作菜单模块统一导出
 */

// 副作用导入：确保 Providers 被注册（只执行一次）
// 必须放在最前面，确保在其他模块使用前完成注册
import './providers/_register';

// 类型定义
export type {
  BlockMenuContext,
  MenuItem,
  BlockMenuProvider,
  MenuState,
} from './types';

// 注册表
export {
  registerCommonMenuProvider,
  registerBlockMenuProvider,
  getMergedMenuItems,
  clearAllProviders,
  getProvidersInfo,
} from './registry';

// 服务
export { blockActionMenuService } from './service';

// 函数边界
export {
  buildBlockMenuContextFromRootBlockId,
  resolveBlockMenuContextPartsFromRootBlockId,
  type BlockMenuContextEditor,
  type BlockMenuContextForEditor,
  type BlockMenuContextParts,
  type BlockMenuContextResolveFailureReason,
} from './functions/buildBlockMenuContextFromRootBlockId';
export {
  openBlockActionMenuForRootBlockId,
  type OpenBlockActionMenuFailureReason,
  type OpenBlockActionMenuForRootBlockIdInput,
  type OpenBlockActionMenuForRootBlockIdResult,
  type OpenBlockActionMenuMode,
} from './orchestration/openBlockActionMenuForRootBlockId';

// UI 组件
export { default as BlockActionMenu } from './ui/BlockActionMenu.vue';

// Providers
export * from './providers';
