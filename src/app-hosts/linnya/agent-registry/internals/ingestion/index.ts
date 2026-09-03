/**
 * @file src/app-hosts/linnya/agent-registry/internals/ingestion/index.ts
 *
 * @description
 * Ingestion 内部任务聚合出口（PDF OCR / Image Description）。
 *
 * 说明：
 * - 子目录各自维护 prompt + modelPolicy（单一来源）；
 * - 本文件只做聚合导出，便于调用方统一 import。
 */

// ⚠️ 显式指向 index：兼容 Node16/NodeNext 模块解析（避免目录导入无法解析）
export * from './pdf_ocr/index';
export * from './image_description/index';


