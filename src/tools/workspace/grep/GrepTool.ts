/**
 * @file GrepTool.ts
 * @description 在当前项目的虚拟文件树中执行低内存 grep。
 */

import { BaseTool, type ToolContext, type ToolParameterSchema } from '../../types';
import {
  WorkspaceGrepArgsSchema,
  WorkspaceGrepResultSchema,
  formatWorkspaceFileLocator,
  type WorkspaceGrepResult,
} from '@app/schemas';
import { searchWorkspaceVfsNodes } from '../../../features/workspace/vfs/orchestration/searchWorkspaceVfsNodes';
import { resolveWorkspaceFileToolRuntime } from '../shared/fileToolContext';
import { formatGrepObservation, type FileToolGrepMatch } from '../shared/fileToolOutput';
import { pluginWorkspaceVfsNodeTypeAccessPolicy } from '../../../app-hosts/linnya/plugin-registry/pluginWorkspaceVfsNodeTypeAccessPolicy';
import { maskMarkdownCitationTokens } from '../../../domains/citation';
import { workspacePathFromLocator } from '../shared/workspaceFileLocator';
import { validateWorkspaceFileToolArguments } from '../shared/workspaceFileToolContract';

export class GrepTool extends BaseTool {
  readonly name = 'grep';

  get description() {
    return [
      'Search text across the current Workspace project virtual file tree.',
      'Use it like grep over Linnya Workspace locators: grep(pattern="...", locator="workspace:/").',
      'It searches the same VFS text projections used by read_file, including enabled plugin document projections. KnowledgeBase and conversation files are intentionally not included.',
      'Grep results are locators, not citation producers. Citation refs in previews are masked; call read_file on the matched locator before citing a source.',
      'First version is literal substring search, not full regex. It uses a persisted line index when available to avoid scanning every file at query time.',
    ].join('\n');
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        minLength: 1,
        description: '要搜索的文本。当前为 literal substring，不是正则表达式。',
      },
      locator: {
        type: 'string',
        minLength: 1,
        description: '限定搜索的 Workspace locator。省略 locator/inode 时表示项目根范围。',
      },
      inode: {
        type: 'string',
        minLength: 1,
        description: '已有 Workspace 节点的稳定 inode。与 locator 二选一。',
      },
      case_sensitive: {
        type: 'boolean',
        description: '是否区分大小写。默认 false。',
      },
      max_results: {
        type: 'integer',
        minimum: 1,
        maximum: 500,
        default: 50,
        description: '最多返回匹配条数，默认 50，最大 500。',
      },
      max_indexed_nodes: {
        type: 'integer',
        minimum: 1,
        maximum: 20000,
        default: 5000,
        description: '本次最多补索引的节点数，默认 5000，最大 20000。',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
    oneOf: [
      {
        type: 'object',
        properties: {
          pattern: { type: 'string', minLength: 1, description: '要搜索的文本。' },
          case_sensitive: { type: 'boolean', description: '是否区分大小写。' },
          max_results: {
            type: 'integer',
            minimum: 1,
            maximum: 500,
            default: 50,
            description: '最多返回匹配条数。',
          },
          max_indexed_nodes: {
            type: 'integer',
            minimum: 1,
            maximum: 20000,
            default: 5000,
            description: '最多补索引的节点数。',
          },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          pattern: { type: 'string', minLength: 1, description: '要搜索的文本。' },
          locator: { type: 'string', minLength: 1, description: '限定搜索的 Workspace locator。' },
          case_sensitive: { type: 'boolean', description: '是否区分大小写。' },
          max_results: {
            type: 'integer',
            minimum: 1,
            maximum: 500,
            default: 50,
            description: '最多返回匹配条数。',
          },
          max_indexed_nodes: {
            type: 'integer',
            minimum: 1,
            maximum: 20000,
            default: 5000,
            description: '最多补索引的节点数。',
          },
        },
        required: ['pattern', 'locator'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          pattern: { type: 'string', minLength: 1, description: '要搜索的文本。' },
          inode: { type: 'string', minLength: 1, description: '已有 Workspace 节点的稳定 inode。' },
          case_sensitive: { type: 'boolean', description: '是否区分大小写。' },
          max_results: {
            type: 'integer',
            minimum: 1,
            maximum: 500,
            default: 50,
            description: '最多返回匹配条数。',
          },
          max_indexed_nodes: {
            type: 'integer',
            minimum: 1,
            maximum: 20000,
            default: 5000,
            description: '最多补索引的节点数。',
          },
        },
        required: ['pattern', 'inode'],
        additionalProperties: false,
      },
    ],
  };

  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    return validateWorkspaceFileToolArguments({
      args,
      schema: WorkspaceGrepArgsSchema,
      errorCode: 'GREP_ARGUMENTS_INVALID',
      toolName: this.name,
    });
  }

  getExecutionSummary(output: string): string {
    try {
      const parsed = JSON.parse(output) as { data?: { pattern?: unknown; total_count?: unknown } };
      const pattern = typeof parsed.data?.pattern === 'string' ? parsed.data.pattern : '';
      const count = typeof parsed.data?.total_count === 'number' ? parsed.data.total_count : 0;
      return pattern ? `grep："${pattern}"，${count} 条匹配` : 'grep：完成。';
    } catch {
      return 'grep：完成。';
    }
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const parsedArgs = WorkspaceGrepArgsSchema.parse(args);

    const runtime = resolveWorkspaceFileToolRuntime(context);
    const pattern = parsedArgs.pattern;
    const path = parsedArgs.locator ? workspacePathFromLocator(parsedArgs.locator) : '/';
    const inode = parsedArgs.inode;

    const result = await searchWorkspaceVfsNodes({
      db: runtime.db,
      projectId: runtime.projectId,
      conversationId: runtime.conversationId,
      instanceId: runtime.instanceId,
      pattern,
      caseSensitive: parsedArgs.case_sensitive,
      maxResults: parsedArgs.max_results,
      maxVisitedNodes: parsedArgs.max_indexed_nodes,
      nodeTypeAccessPolicy: pluginWorkspaceVfsNodeTypeAccessPolicy,
      ...(inode ? { inode } : { path }),
    });

    if (!result.ok) {
      throw new Error(result.hint ? `${result.message} ${result.hint}` : result.message);
    }

    const matches = result.matches.map(
      (match): FileToolGrepMatch => ({
        locator: formatWorkspaceFileLocator(match.node.path),
        inode: match.node.inode,
        name: match.node.name,
        type: match.node.type,
        source: match.node.source,
        line: match.line,
        column: match.column,
        // grep 只负责定位。可引用 ref 必须由 read_file 连同同窗口 metadata 一起进入模型上下文。
        preview: maskMarkdownCitationTokens(match.preview),
      })
    );
    const indexMetadata = result.index
      ? {
          available: result.index.available,
          indexed_nodes: result.index.indexedNodes,
          skipped_fresh_nodes: result.index.skippedFreshNodes,
          visited_nodes: result.index.visitedNodes,
          truncated_indexing: result.index.truncatedIndexing,
          truncated_files: result.index.truncatedFiles,
        }
      : { available: false };

    const data: WorkspaceGrepResult['data'] = {
      source_kind: 'workspace_vfs',
      pattern,
      ...(inode
        ? { searched_inode: inode }
        : { searched_locator: formatWorkspaceFileLocator(path) }),
      matches,
      total_count: matches.length,
      truncated: result.truncated,
      index: indexMetadata,
    };

    const toolResult = WorkspaceGrepResultSchema.parse({
      data,
      observation: formatGrepObservation({
        pattern,
        matches,
        truncated: result.truncated,
      }),
    });

    return JSON.stringify(toolResult, null, 2);
  }
}
