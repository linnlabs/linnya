/**
 * @file src/tools/deep_research/writeReport.ts
 * @description Deep Research 的最终报告发布工具：只负责输出最终报告正文。
 *
 * 中文备注（设计意图）：
 * - 这个工具本身不做任何检索/写入副作用，只承载“最终报告正文”这一份产物；
 * - 通过通用 `control.finalAnswer` 契约请求 ToolNode 生成 `final_answer` 事件；
 * - 同时声明工具消息不进入可见时间轴，让用户感知为“直接输出最终答案”。
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '../types';
import type { StructuredToolResult } from '../types';

function readNonEmptyString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

export class WriteReportTool extends BaseTool {
  readonly name = 'write_report';

  get description(): string {
    return `Output the final research report (content only).

# When to Use
- 当你已经完成证据阅读与结构整理，需要一次性输出最终报告正文时使用。
- 报告引用只能使用 citation-aware read_file 结果中与来源上下文同屏出现的 canonical [@XXXXXX]；不得编造 ref，也不得把 [#XXXXXX]、doc_id、block_id、UUID 或结果序号当作证据引用。
- read_file 标记 snapshot_status=persisted source_status=not_checked 时，只表示持久化快照可用，不表示实时来源已经复核。

# Input
- report: 报告正文（Markdown）

# Output
Returns JSON: { data, observation, control }.
- data.report: 原样保留报告正文
- control.finalAnswer: 请求 runtime 将报告正文投影为 final_answer 事件
- control.terminateRun=true: 执行完后直接结束本轮 run（避免回到 LLM 生成重复复述文本）。`;
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      report: {
        type: 'string',
        description: '最终报告正文（Markdown）。必须包含完整内容，不要省略。',
      },
    },
    required: ['report'],
  };

  async run(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const validation = this.validateArguments(args);
    if (!validation.success) {
      throw new Error(validation.error ?? 'write_report: invalid arguments');
    }

    const report = readNonEmptyString(args['report']);
    if (!report) {
      throw new Error('write_report: report is required');
    }

    const result: StructuredToolResult<{ report: string }> = {
      data: { report },
      /**
       * 给模型的 observation 必须短，避免把“整篇报告”重复注入上下文造成 WorkingMemory 压力。
       * 报告正文的权威载体是 data.report；control.finalAnswer 用于通用 runtime 投影。
       */
      observation: `write_report 已接收报告正文（长度=${report.length} chars）。`,
      control: {
        finalAnswer: report,
        terminateRun: true,
        reason: 'write_report: terminate after tool output',
      },
    };

    return JSON.stringify(result);
  }
}
