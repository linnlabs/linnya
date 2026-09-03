/**
 * @file src/parsers/pdfParser/index.ts
 *
 * **功能 (What):** PDF解析器模块主导出文件
 * **输入 (Input):** 无
 * **输出 (Output):** 导出PDF解析器及相关功能
 * **副作用 (Side-effects):** 无副作用，纯导出
 */

// 主解析器类
export { PdfParser } from './PdfParser';

// 类型定义
export * from './types';

// 工厂函数
export { createPdfParser } from './factory';

// 策略模块（供高级用户使用）
export * from './strategies';

// 工具函数（供扩展使用）
export * from './utils';

// 布局分析（供研究使用）
export * from './layout';

// 适配器（供定制使用）
export * from './adapters';
