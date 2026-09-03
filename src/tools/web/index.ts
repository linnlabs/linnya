/**
 * @file src/tools/web/index.ts
 * @description Web 工具模块入口（聚合 web_search + web_read）
 *
 * 说明：
 * - 该目录用于把历史上的 `src/tools/websearch`、`src/tools/webread` 统一归档到 `src/tools/web/` 下
 * - 保持对外导出的符号名不变（例如 webSearchToolClasses/webReadToolClasses），减少上层改动范围
 */

export * from './websearch';
export * from './webread';

