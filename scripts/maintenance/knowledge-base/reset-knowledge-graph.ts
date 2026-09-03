/**
 * 开发维护命令：清空指定知识库的软知识图谱数据，为重新抽取做准备。
 *
 * 只清理图谱派生数据，不删除知识库文档元数据与 Source of Truth。
 * 建议在 Electron 主进程退出后执行，避免 worker 同时写入。
 *
 * 用法：
 *   pnpm run kg:reset -- --kbId default
 *   pnpm run kg:reset -- --kbId default --withQdrant
 */
import {
  clearKnowledgeGraphDatabaseTables,
  deleteKnowledgeGraphVectorCollections,
  loadKnowledgeGraphMaintenanceEnvironment,
  parseKnowledgeGraphResetArgs,
} from './knowledge-graph-reset-runtime';

const GRAPH_TABLES = [
  'knowledge_graph_edges',
  'knowledge_graph_nodes',
  'knowledge_graph_doc_status',
  'knowledge_graph_vector_doc_status',
  'knowledge_graph_index_status',
] as const;

async function main(): Promise<void> {
  loadKnowledgeGraphMaintenanceEnvironment();
  const args = parseKnowledgeGraphResetArgs(process.argv.slice(2));

  if (args.withQdrant) {
    console.log(`[KG-RESET] 将清空知识库 ${args.kbId} 的图谱向量集合。`);
    await deleteKnowledgeGraphVectorCollections(args);
  }

  console.log(`[KG-RESET] 将清空知识库 ${args.kbId} 的 SQLite 图谱派生数据。`);
  clearKnowledgeGraphDatabaseTables({ kbId: args.kbId, tableNames: GRAPH_TABLES });
  console.log('[KG-RESET] 完成。重新启动 App 后，编排器会重新抽取并建立索引。');
}

main().catch((error: unknown) => {
  console.error('[KG-RESET] 失败：', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
