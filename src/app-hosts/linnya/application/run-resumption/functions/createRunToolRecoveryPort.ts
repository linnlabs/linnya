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
  'web_read',
  'task_read',
  'skill',
  'subagent',
  'subrun_batch',
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
