/**
 * @file src/tools/tool_output/ToolOutputReadTool.ts
 *
 * @description
 * 读取 ToolOutputStore 中落盘的超长工具输出（按字符 cursor 分页）。
 *
 * 设计目标（中文备注）：
 * - 对齐 OpenCode：工具输出超限后落盘，模型需要细节时再“按需续读”，避免上下文爆炸；
 * - 保持工具协议稳定：此工具只读 store 文件，不依赖 EventStore，不耦合具体业务工具。
 * - 本类是 ToolOutputStore 唯一 live Agent facade；历史 Resource URI 只在 replay 边界解释。
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '../types';
import { readToolOutputTextWindowByContext } from './toolOutputStore';
import {
  ToolOutputReadResultSchema,
  type ToolOutputReadResult,
} from '@app/schemas';
import {
  TOOL_OUTPUT_READ_DEFAULT_CHARS,
  TOOL_OUTPUT_READ_MAX_CHARS,
  ToolOutputReadArgsSchema,
} from './definitions/toolOutputRead';
import { buildToolOutputReadObservation } from './functions/buildToolOutputReadObservation';

export class ToolOutputReadTool extends BaseTool {
  readonly name = 'tool_output_read';

  /**
   * 硬上限（根因级约束）：
   * - 该工具的结果若再次触发 ToolNode 的“超长 observation 落盘截断”，就会形成套娃；
   * - 因此这里用“文本单位（中文汉字/英文单词）”做强约束，并辅以字符数兜底。
   *
   * 注意：
   * - 这里的上限应显著小于 ToolNode 的执行期 observation 预览阈值（maxChars=20_000, maxLines=1_200）。
   */
  readonly description = `Reads a large tool output saved in ToolOutputStore (by blob_id) with pagination.

# Canonical entry
- Pass the 16-hex blob_id from a truncation hint or a tool_output:// durable reference.
- Cursor is a 0-based UTF-16 character offset. Copy next_offset unchanged to continue.

# When to Use
- When a tool output was truncated and you need to inspect the full content.
- Use offset to paginate and limit to bound the requested character window.

# Notes
- blob_id is a 16-hex id printed in the truncation hint.
- This tool returns a bounded text window plus cursor info for continuing.`;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      blob_id: {
        type: 'string',
        description: 'ToolOutputStore blob id (16 hex).',
      },
      offset: {
        type: 'integer',
        description: '0-based UTF-16 character offset. Defaults to 0.',
        default: 0,
        minimum: 0,
      },
      limit: {
        type: 'integer',
        description: `Maximum requested characters. Defaults to ${TOOL_OUTPUT_READ_DEFAULT_CHARS}, maximum ${TOOL_OUTPUT_READ_MAX_CHARS}.`,
        default: TOOL_OUTPUT_READ_DEFAULT_CHARS,
        minimum: 1,
        maximum: TOOL_OUTPUT_READ_MAX_CHARS,
      },
    },
    required: ['blob_id'],
    additionalProperties: false,
  };

  getExecutionSummary(output: string): string {
    const parsed: unknown = JSON.parse(output);
    const result = ToolOutputReadResultSchema.parse(parsed);
    return `读取 ToolOutputStore(${result.data.blob_id})：行 ${result.data.start_line}-${result.data.end_line} / ${result.data.total_lines}`;
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const parsedArgs = ToolOutputReadArgsSchema.parse(args);

    // 中文备注：ToolOutput 归属强绑定 conversation-root，因此这里必须使用 context 读取。
    const window = await readToolOutputTextWindowByContext({
      context,
      blobId: parsedArgs.blob_id,
      args: parsedArgs,
    });

    const result: ToolOutputReadResult = {
      data: {
        blob_id: parsedArgs.blob_id,
        start_offset: window.startOffset,
        end_offset_exclusive: window.endOffsetExclusive,
        total_chars: window.totalChars,
        start_line: window.startLine,
        end_line: window.endLine,
        total_lines: window.totalLines,
        has_more: window.nextOffset !== null,
        next_offset: window.nextOffset,
        window_text: window.windowText,
      },
      observation: buildToolOutputReadObservation({
        blobId: parsedArgs.blob_id,
        startOffset: window.startOffset,
        endOffsetExclusive: window.endOffsetExclusive,
        totalChars: window.totalChars,
        startLine: window.startLine,
        endLine: window.endLine,
        totalLines: window.totalLines,
        nextOffset: window.nextOffset,
        windowText: window.windowText,
      }),
    };

    return JSON.stringify(ToolOutputReadResultSchema.parse(result));
  }
}
