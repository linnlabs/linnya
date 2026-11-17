import type { KnowledgeBaseService } from '../../application/knowledgeBaseService';

export interface KnowledgeToolRuntime {
  readonly service: KnowledgeBaseService;
  listProjectKnowledgeBaseIds(projectId: string): readonly string[];
  enterTool(): () => void;
}

let runtime: KnowledgeToolRuntime | undefined;

/** 仅由插件 activation 装配；停用先拒绝 busy，再撤销这个执行入口。 */
export function registerKnowledgeToolRuntime(port: KnowledgeToolRuntime): () => void {
  if (runtime) throw new Error('知识库工具运行时已经装配');
  runtime = port;
  return () => { if (runtime === port) runtime = undefined; };
}

export function getKnowledgeToolRuntime(): KnowledgeToolRuntime {
  if (!runtime) throw new Error('知识库插件未启用');
  return runtime;
}

/** 整个工具（包括子运行、SoT 物化和证据保存）结束后才释放活动归属。 */
export async function runWithKnowledgeToolRuntime<T>(run: () => Promise<T>): Promise<T> {
  const release = getKnowledgeToolRuntime().enterTool();
  try { return await run(); } finally { release(); }
}
