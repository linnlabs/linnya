/**
 * 开发维护命令：只重置指定知识库的图谱向量索引状态。
 *
 * 该命令不会删除图谱节点、边或抽取状态，因此不会重新触发 LLM 抽取。
 * 建议在 Electron 主进程退出后执行，避免 worker 同时写入。
 *
 * 用法：
 *   pnpm run kg:reset-vectors -- --kbId default
 *   pnpm run kg:reset-vectors -- --kbId default --withQdrant
 */
import {
  clearKnowledgeGraphDatabaseTables,
  deleteKnowledgeGraphVectorCollections,
  loadKnowledgeGraphMaintenanceEnvironment,
  parseKnowledgeGraphResetArgs,
} from './knowledge-graph-reset-runtime';

async function main(): Promise<void> {
  loadKnowledgeGraphMaintenanceEnvironment();
  const args = parseKnowledgeGraphResetArgs(process.argv.slice(2));

  if (args.withQdrant) {
    console.log(`[KG-RESET-VECTORS] 将清空知识库 ${args.kbId} 的图谱向量集合。`);
    await deleteKnowledgeGraphVectorCollections(args);
  }

  console.log(`[KG-RESET-VECTORS] 将重置知识库 ${args.kbId} 的图谱向量索引状态。`);
  clearKnowledgeGraphDatabaseTables({
    kbId: args.kbId,
    tableNames: ['knowledge_graph_vector_doc_status'],
  });
  console.log('[KG-RESET-VECTORS] 完成。重新启动 App 后，编排器会重新建立向量索引。');
}

main().catch((error: unknown) => {
  console.error(
    '[KG-RESET-VECTORS] 失败：',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
