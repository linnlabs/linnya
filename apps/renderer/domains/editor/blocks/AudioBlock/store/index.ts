/**
 * @file store/index.ts
 * @description AudioBlock Store 聚合导出
 * 
 * 职责：
 * - 导出所有拆分后的 Store
 * - 导出类型定义
 * - 导出 Repository
 */

import { useAudioContentStore } from './audioContent.store';
import { useAudioRuntimeStore } from './audioRuntime.store';
import { useAudioEditorsStore } from './audioEditors.store';

// 导出所有 Store
export { useAudioContentStore, useAudioRuntimeStore, useAudioEditorsStore };

// 导出 Store 类型
export type AudioContentStore = ReturnType<typeof useAudioContentStore>;
export type AudioRuntimeStore = ReturnType<typeof useAudioRuntimeStore>;
export type AudioEditorsStore = ReturnType<typeof useAudioEditorsStore>;

// 导出 Repository
export { audioBlockRepository } from '../repository/audioRepository';

// 导出类型
export * from '../types/audioBlock';
