/**
 * @file src/app-hosts/linnya/agent-registry/internals/index.ts
 *
 * @description
 * Internal（后端内部任务）聚合出口：
 * - 与 `agents/index.ts`、`chats/index.ts` 风格一致，做到“入口统一、配置内聚”。
 *
 * 约束：
 * - 内部任务的 prompt + modelPolicy 必须在各自同目录 `index.ts` 里写清楚；
 * - 业务调用点尽量只 import 本目录的聚合出口或具体任务目录出口，避免直接引用 prompt.ts。
 */

// ⚠️ 显式指向 index：兼容 Node16/NodeNext 模块解析（避免目录导入无法解析）
export * as ingestion from './ingestion/index';
export * as knowledgeGraphExtraction from './knowledge_graph_extraction/index';
export * as transcription from './transcription/index';

