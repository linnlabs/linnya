// apps/renderer/domains/editor/features/blockActionMenu/providers/_register.ts
/**
 * Provider 自注册入口（副作用模块）
 *
 * 设计目的：
 * - 将 Provider 注册从组件生命周期中分离
 * - 模块导入时自动注册，只执行一次
 * - 不受 HMR、路由切换等影响
 *
 * 使用方式：
 * - 在 blockActionMenu/index.ts 中导入此模块即可
 * - import './providers/_register';
 */

import { registerCommonMenuProvider, registerBlockMenuProvider } from '../registry';
import { commonProvider } from './commonProvider';
import { imageBlockMenuProvider } from '../../../blocks/ImageBlock/menu/imageBlockMenuProvider';

// 模块级标记，确保只注册一次
let registered = false;

/**
 * 确保所有 Providers 已注册
 *
 * 此函数是幂等的，多次调用只会执行一次注册
 */
export function ensureProvidersRegistered(): void {
  if (registered) return;
  registered = true;

  // 注册通用 Provider
  registerCommonMenuProvider(commonProvider);

  // 注册块专属 Provider
  registerBlockMenuProvider('imageBlock', imageBlockMenuProvider);
  // 已移除注册完成 console.log：避免启动时刷屏
}

// 模块加载时立即执行注册
ensureProvidersRegistered();

// HMR 支持：开发时修改 Provider 后能热更新
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    // HMR 时需要重新加载整个模块，但由于 registered 标记
    // 和 registry.ts 中的重复检测，不会产生重复注册
    // 已移除 HMR console.log：避免开发时刷屏
  });
}
