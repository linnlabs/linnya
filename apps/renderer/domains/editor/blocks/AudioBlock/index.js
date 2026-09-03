/**
 * AudioBlock 特性模块出口。
 * 
 * Store 已拆分为多个独立模块（content/runtime/editors）
 */

export { AudioBlock } from './AudioBlock';

// 导出所有 Store
export {
  useAudioContentStore,
  useAudioRuntimeStore,
  useAudioEditorsStore,
  audioBlockRepository,
} from './store/index';

// 导出类型
export * from './types/audioBlock';

// 导出菜单
export { audioBlockMenuProvider } from './menu/audioBlockMenuProvider'; 