/**
 * @file ReadFileTool.ts
 * @description `read_file` 的模型 schema 与 application use case 适配器。
 */

import {
  FileLocatorSchema,
  WORKSPACE_READ_FILE_DEFAULT_LIMIT,
  WORKSPACE_READ_FILE_MAX_LIMIT,
  WorkspaceReadFileArgsSchema,
  WorkspaceReadFileResultSchema,
} from '@app/schemas';
import { readFileForTool } from '../../../app-hosts/linnya/application/file-read';
import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../types';
import { validateWorkspaceFileToolArguments } from '../shared/workspaceFileToolContract';

export class ReadFileTool extends BaseTool {
  readonly name = 'read_file';

  get description() {
    return [
      'Read a project VFS file, a current-conversation file, or a host absolute file through one explicit locator contract.',
      'Use workspace:/..., conversation:/..., or file:///...; bare paths are invalid and never trigger source guessing.',
      'Text returns a character window. JPEG, PNG, and WebP are verified and attached automatically; identical pixels already attached in the current run are not injected again.',
      'PDF, Office, archives, other binary formats, and unsupported encodings must first be converted with Shell/CLI.',
      'Use inode only for Workspace identity. view="document" is also Workspace-only.',
      'Markdown citations appear as canonical [@XXXXXX] tokens with same-window source metadata.',
    ].join('\n');
  }

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
        minimum: 0,
        description: '仅文本或 DocumentView 使用的字符偏移；省略时为 0。图片禁止传入。',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: WORKSPACE_READ_FILE_MAX_LIMIT,
        description: `仅文本或 DocumentView 使用的最大字符数；默认 ${WORKSPACE_READ_FILE_DEFAULT_LIMIT}，最大 ${WORKSPACE_READ_FILE_MAX_LIMIT}。图片禁止传入。`,
      },
      view: {
        type: 'string',
        enum: ['text', 'document'],
        description: '省略或 text 为普通阅读；document 只用于 Workspace 结构化视图。',
      },
    },
    required: [],
    additionalProperties: false,
    // locator-only 与 inode-only 是两个封闭合同；成功结果可以同时返回二者，不代表输入可同传。
    oneOf: [
      {
        type: 'object',
        properties: {
          locator: { type: 'string', minLength: 1, description: '明确的文件 locator。' },
          offset: { type: 'integer', minimum: 0, description: '字符偏移。' },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: WORKSPACE_READ_FILE_MAX_LIMIT,
            description: '最大字符数。',
          },
          view: { type: 'string', enum: ['text', 'document'], description: '读取视图。' },
        },
        required: ['locator'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          inode: { type: 'string', minLength: 1, description: '已有 Workspace 节点的稳定 inode。' },
          offset: { type: 'integer', minimum: 0, description: '字符偏移。' },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: WORKSPACE_READ_FILE_MAX_LIMIT,
            description: '最大字符数。',
          },
          view: { type: 'string', enum: ['text', 'document'], description: '读取视图。' },
        },
        required: ['inode'],
        additionalProperties: false,
      },
    ],
  };

  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    if ('locator' in args && !FileLocatorSchema.safeParse(args.locator).success) {
      return {
        success: false,
        error:
          '[READ_FILE_LOCATOR_INVALID] locator 必须使用 workspace:、conversation: 或 canonical file: 地址。',
      };
    }
    return validateWorkspaceFileToolArguments({
      args,
      schema: WorkspaceReadFileArgsSchema,
      errorCode: 'READ_FILE_ARGUMENTS_INVALID',
      toolName: this.name,
    });
  }

  getExecutionSummary(output: string): string {
    try {
      const parsed = WorkspaceReadFileResultSchema.parse(JSON.parse(output));
      return `read_file：${parsed.data.locator} (${parsed.data.content_type})`;
    } catch {
      return 'read_file：完成。';
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
