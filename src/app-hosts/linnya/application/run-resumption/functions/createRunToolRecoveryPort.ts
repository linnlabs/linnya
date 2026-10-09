import type { graph } from '@linnlabs/linnkit/runtime-kernel';

// 只包含已知无外部写入的读取，以及由持久 child owner 保证原身份的嵌入调用。
// 这不是工具参数幂等缓存；重复读取允许得到新内容，未知写入绝不据名称相似而推断安全。
const replayableTools = new Set([
  'list_files',
  'read_file',
  'grep',
  'tool_output_read',
  'knowledge_search',
  'knowledge_read',
  'web_search',
  'search_web',
  'assemble_web_sources',
  'web_read',
  'task_read',
  'skill',
  'subagent',
  'subrun_batch',
  // 固定阶段 slot 的 Host 用例；已完成 child 复取原结果，版本接纳仍由研究 owner 决定。
  'research_run',
]);

export function createRunToolRecoveryPort(receipts?: {
  read(
    toolCallId: string,
    toolName: string
  ): { result: string | null; atomic_owner: number } | undefined;
}): graph.ToolRecoveryPort {
  return {
    async reconcile(call) {
      const receipt = receipts?.read(call.id, call.function.name);
      // 交付是对当前依赖版本的检查。普通 returned 回执证明旧检查完成，不能证明暂停期间
      // 文稿仍未变化；必须重查后才能发出终止控制。submit 的原子写入回执仍沿下面复取。
      if (call.function.name === 'complete_research') return { kind: 'retry' };
      if (receipt?.result !== null && receipt?.result !== undefined) {
        return {
          kind: 'settled',
          result: { success: true, result: receipt.result, durationMs: 0 },
        };
      }
      // 同事务 owner 的空凭据证明 mutation 未提交；外部动作没有这项承诺。
      if (receipt?.atomic_owner === 1) return { kind: 'retry' };
      if (replayableTools.has(call.function.name)) return { kind: 'retry' };
      return {
        kind: 'blocked',
        reason: `The result of ${call.function.name} is unknown; owner reconciliation is required`,
      };
    },
  };
}
