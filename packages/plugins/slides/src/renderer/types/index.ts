/**
 * Slides Domain 类型统一导出
 *
 * - api.ts         → 后端 DTO re-export
 * - preview.ts     → 前端 ViewModel（轻量预览层）
 * - render.ts      → Konva 渲染协议类型（@plugin/slides/shared re-export）
 */

export * from './api';
export * from './preview';
export * from './render';
