/**
 * @file ReadFileTool.ts
 * @description `read_file` 的模型 schema 与 application use case 适配器。
 */

import {
  FileLocatorSchema,
  WORKSPACE_READ_FILE_DEFAULT_LIMIT,
  WORKSPACE_READ_FILE_DOCUMENT_DEFAULT_MAX_CHARS,
  WORKSPACE_READ_FILE_DOCUMENT_MAX_CHARS,
  WORKSPACE_READ_FILE_MAX_LIMIT,
  WorkspaceReadFileArgsSchema,
  WorkspaceReadFileResultSchema,
  WorkspaceFileLocatorSchema,
} from '@app/schemas';
import { readFileForTool } from '../../../app-hosts/linnya/application/file-read';
import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../types';
import { validateWorkspaceFileToolArguments } from '../shared/workspaceFileToolContract';

const READ_FILE_MODEL_INPUT_REQUIREMENT = Object.freeze({
  requires_image_input: true,
  placements: Object.freeze(['tool_result_image'] as const),
});

export class ReadFileTool extends BaseTool {
  readonly name = 'read_file';
  readonly argumentValidationErrorCode = 'READ_FILE_ARGUMENTS_INVALID';
  // 读文本与读图共用一个工具；模型收不到工具结果图片时读图降级为元数据，不能让 run 失败。
  readonly modelInputRequirement = READ_FILE_MODEL_INPUT_REQUIREMENT;
  readonly modelInputDelivery = 'when_supported' as const;
  /**
   * 每次调用的模型输入要求只看参数：Workspace 文档（workspace: locator 或 inode）只返回文本或
   * DocumentView，不会产出图片，因此不要求模型能力；conversation:/file: 可能按 magic bytes 读成图片，
   * 保留图片要求。ToolNode 只对有要求的调用检查“最近一次成功的模型”，所以无模型的 Host 直接调用
   * （CLI tools call）读 Workspace 文本不会因缺少模型失败，Agent 读图的准入与降级保持不变。
   * 必须是确定性规则、不做 I/O；locator 非法时由参数校验先拒绝。
   */
  readonly resolveModelInputRequirement = (args: Record<string, unknown>) =>
    typeof args.locator === 'string' && !WorkspaceFileLocatorSchema.safeParse(args.locator).success
      ? READ_FILE_MODEL_INPUT_REQUIREMENT
      : undefined;

  get description() {
    return [
      'Read a project VFS file, a current-conversation file, or a host absolute file through one explicit locator contract.',
      'Use workspace:/..., conversation:/..., or file:///...; bare paths are invalid and never trigger source guessing.',
      'Text uses the mainstream 1-based line window: offset is the starting line and limit is the maximum number of lines. Returned source lines are numbered for precise grep/edit/inspect follow-up.',
      'Plain-text receipts give character and Han counts for this returned body window and the complete source text. Characters are Unicode code points including whitespace and punctuation; Han uses Unicode Script=Han. Counts exclude line labels, paging hints and citation source appendices. Structured DocumentView and images do not report these text counts.',
      'Structured DocumentView alone uses offset_chars/max_chars. JPEG, PNG, and WebP are verified and attached automatically; identical pixels already attached in the current run are not injected again.',
      'If a tool-output truncation hint appears, use its tool_output_read call to finish this returned window before following the file next-page hint. Blob character offsets are not file line numbers or DocumentView offsets.',
      'PDF, Office, archives, other binary formats, and unsupported encodings must first be converted with Shell/CLI.',
      'Use inode only for Workspace identity. view="document" is also Workspace-only.',
      'Provide exactly one of locator or inode. Never send both. Text and DocumentView window fields cannot be mixed.',
      'Markdown citations appear as canonical [@XXXXXX] tokens with same-window source metadata.',
    ].join('\n');
  }

  // 模型目录使用各协议共有的顶层 object；互斥身份等跨字段规则由下方正式 admission 执行。
  // 顶层 oneOf 会被 Anthropic 拒绝，不能把执行校验的分支复制到模型输入 schema。
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      locator: {
        type: 'string',
        minLength: 1,
        description:
          '明确的文件 locator：workspace:/...、conversation:/... 或 file:///...。不接受裸路径，也不跨地址空间 fallback。',
      },
      inode: {
        type: 'string',
        minLength: 1,
        description: '已有 Workspace 节点的稳定 inode。与 locator 二选一。',
      },
      offset: {
        type: 'integer',
        minimum: 1,
        description: '普通文本的 1-based 起始行；省略时为 1。图片与 DocumentView 禁止传入。',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: WORKSPACE_READ_FILE_MAX_LIMIT,
        description: `普通文本的最大行数；默认 ${WORKSPACE_READ_FILE_DEFAULT_LIMIT}，最大 ${WORKSPACE_READ_FILE_MAX_LIMIT}。图片与 DocumentView 禁止传入。`,
      },
      offset_chars: {
        type: 'integer',
        minimum: 0,
        description: '仅 DocumentView 使用的字符偏移；省略时为 0。',
      },
      max_chars: {
        type: 'integer',
        minimum: 1,
        maximum: WORKSPACE_READ_FILE_DOCUMENT_MAX_CHARS,
        description: `仅 DocumentView 使用的最大字符数；默认 ${WORKSPACE_READ_FILE_DOCUMENT_DEFAULT_MAX_CHARS}，最大 ${WORKSPACE_READ_FILE_DOCUMENT_MAX_CHARS}。`,
      },
      view: {
        type: 'string',
        enum: ['text', 'document'],
        description: '省略或 text 为普通阅读；document 只用于 Workspace 结构化视图。',
      },
    },
    required: [],
    additionalProperties: false,
  };

  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    if ('locator' in args && !FileLocatorSchema.safeParse(args.locator).success) {
      return {
        success: false,
        error:
          '[READ_FILE_LOCATOR_INVALID] locator 必须使用 workspace:、conversation: 或 canonical file: 地址。\n修正地址后再调用。最小结构示例：{"locator":"workspace:/report.md"}',
      };
    }
    return validateWorkspaceFileToolArguments({
      args,
      schema: WorkspaceReadFileArgsSchema,
      errorCode: this.argumentValidationErrorCode,
      toolName: this.name,
      example: { locator: 'workspace:/report.md' },
    });
  }

  getExecutionSummary(output: string): string {
    try {
      const parsed = WorkspaceReadFileResultSchema.parse(JSON.parse(output));
      return `read_file：${parsed.data.locator} (${parsed.data.content_type})`;
    } catch {
      return 'read_file：结果格式异常，无法确认读取内容。';
    }
  }

  async run(rawArgs: Record<string, unknown>, context: ToolContext): Promise<string> {
    return readFileForTool({
      args: WorkspaceReadFileArgsSchema.parse(rawArgs),
      rawArgs,
      context,
    });
  }
}
