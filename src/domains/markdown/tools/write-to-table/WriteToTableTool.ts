/**
 * @file src/domains/markdown/tools/write-to-table/WriteToTableTool.ts
 * @description Markdown TableBlock 填充工具 - 声明式前端桥接工具
 * 
 * 这是一个"声明式"工具，它不执行后端逻辑，而是作为 Agent 向前端
 * 表达"写入意图"的标准化事件载体。实际的 ProseMirror 编辑器操作
 * 由前端在接收到 tool_output 事件时执行。
 */

import {
  BaseTool,
  type ToolContext,
  type StructuredToolResult,
  type ToolArgs,
} from '../../../../tools/types';
import {
  readWriteToTableOutput,
  WriteToTableArgsSchema,
  type WriteToTableData,
} from '@app/schemas';

/**
 * 表格写入工具参数接口
 */
type WriteToTableArgs = ToolArgs & {
  /** 要写入的内容 */
  content: string;
  /** 写入模式：replace(替换) 或 append(追加)，默认为 append */
  mode?: 'replace' | 'append';
  /** 可选：目标行索引（0基础），如果不提供则使用当前行 */
  row?: number;
  /** 可选：目标列索引（0基础），如果不提供则使用当前列 */
  col?: number;
};

/**
 * Markdown TableBlock 写入工具
 * 
 * 这个工具的设计理念是"声明式桥接"：
 * - 后端：接收参数，原样返回，生成标准化的 tool_output 事件
 * - 前端：监听 tool_output 事件，经 TableFillWritePort 写入当前 Markdown TableBlock
 * 
 * 这种设计完全遵循了我们事件驱动架构的原则，保持了前后端的职责分离。
 */
export class WriteToTableTool extends BaseTool<WriteToTableArgs> {
  readonly name = 'write_to_table';
  readonly description = '将内容写入表格的单元格。';
  
  readonly parameters = {
    type: 'object' as const,
    properties: {
      content: {
        type: 'string' as const,
        description: '要写入到表格单元格的文本内容，除非用户要求，否则不要使用Makrdown格式'
      },
      mode: {
        type: 'string' as const,
        enum: ['replace', 'append'],
        description: '写入模式。replace: 替换单元格内容；append: 追加到现有内容（默认），除非用户要求，否则不要使用Makrdown格式',
        default: 'append'
      },
      row: {
        type: 'integer' as const,
        minimum: 0,
        description: '目标行索引（0基础）。如果不提供，将使用当前处理的行'
      },
      col: {
        type: 'integer' as const,
        minimum: 0,
        description: '目标列索引（0基础）。如果不提供，将使用当前输出列'
      }
    },
    required: ['content'],
    additionalProperties: false
  };

  /**
   * 执行工具 - 声明式实现
   * 
   * 这个方法不执行任何实际的编辑器操作，它的作用是：
   * 1. 验证参数
   * 2. 将参数原样返回，作为 tool_output 事件的载体
   * 3. 让前端能够通过 onToolOutput 回调接收到写入意图
   */
  async run(args: WriteToTableArgs, _context: ToolContext): Promise<string> {
    // 参数验证
    if (!args.content) {
      throw new Error('content 参数是必需的');
    }

    // 构建返回结果，包含所有必要信息
    const admittedArgs = WriteToTableArgsSchema.parse(args);
    const data: WriteToTableData = {
      action: 'write_to_table',
      content: admittedArgs.content,
      mode: admittedArgs.mode,
      ...(admittedArgs.row !== undefined && { row: admittedArgs.row }),
      ...(admittedArgs.col !== undefined && { col: admittedArgs.col }),
      timestamp: Date.now(),
    };
    const result: StructuredToolResult<WriteToTableData> = {
      data,
      observation: '表格内容已写入。',
      // write_to_table 是 table_ai_fill 的最终产物出口。完成写入后结束当前 child，
      // 避免硬提示再次要求调用同一工具；父 subrun_batch run 不受该 child control 影响。
      control: {
        terminateRun: true,
        finalAnswer: admittedArgs.content,
        reason: 'write_to_table completed',
      },
    };

    // 工具 wire 协议仍使用 JSON 字符串；ToolNode 会解析并持久化 data 与 observation。
    return JSON.stringify(result);
  }

  /**
   * 为历史压缩提供执行摘要
   */
  getExecutionSummary(output: string): string {
    const result = readWriteToTableOutput(output);
    if (!result) {
      return 'Write to table tool executed';
    }

    const preview =
      result.content.length > 50 ? `${result.content.substring(0, 50)}...` : result.content;
    return `写入表格内容: "${preview}"`;
  }
}
