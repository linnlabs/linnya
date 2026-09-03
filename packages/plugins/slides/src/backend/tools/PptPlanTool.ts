import { BaseTool, type ToolContext, type ToolParameterSchema } from '@plugin/backend/toolRuntime';
import type { StructuredToolResult } from '@plugin/backend/toolRuntime';
import {
  createPptPlanData,
  PptPlanDataSchema,
  PptPlanToolArgsSchema,
  type PptPlanData,
} from '@plugin/slides/shared/pptPlanToolContract';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function describeValueType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function looksLikeJsonArrayString(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']');
}

function formatIssuePath(path: readonly (string | number)[]): string {
  if (path.length === 0) return 'arguments';
  return path.reduce<string>((result, segment) => {
    return typeof segment === 'number'
      ? `${result}[${segment}]`
      : result.length === 0
        ? segment
        : `${result}.${segment}`;
  }, '');
}

/**
 * 构造面向 LLM 的 `pages` 参数错误消息。
 *
 * 设计原则：
 * - 直接给出错误示例 + 正确示例，强制模型改形；
 * - 对「把数组字符串化」这种常见偏差单独提示，要求不要 JSON.stringify、也不要加引号；
 * - 提醒中文引号/字符可能破坏嵌套 JSON，促使模型直接用原生数组结构。
 */
function buildInvalidPagesError(value: unknown): string {
  const actualType = describeValueType(value);
  const baseLines: string[] = [
    `Invalid argument \`pages\`: expected a non-empty array of {title, content} objects, but received ${actualType}.`,
    'Pass the array directly as tool_use.input.pages, NOT as a JSON-encoded string.',
    'Wrong:  "pages": "[{\\"title\\": \\"...\\"}]"',
    'Right:  "pages": [{"title": "...", "content": "..."}]',
  ];

  if (looksLikeJsonArrayString(value)) {
    baseLines.splice(
      1,
      0,
      'The previous value looked like a JSON-encoded array string, and contained malformed/unescaped quotes so it could not be parsed.',
      'Do NOT call JSON.stringify on pages; do NOT wrap it in quotes. Output the array structure directly in the tool arguments.',
      'Keep each page.content short (<= 120 chars) to avoid embedding many quoted phrases that break JSON escaping.'
    );
  }

  return baseLines.join('\n');
}

/**
 * 将计划格式化为人类可读的文本，用于 AI 审批上下文。
 */
function formatPlanForReview(data: PptPlanData): string {
  const lines: string[] = [];

  lines.push(`PPT 计划：${data.title}`);
  lines.push(`共 ${data.pageCount} 页`);

  if (data.audience) lines.push(`受众：${data.audience}`);

  lines.push('');
  lines.push('视觉方向');
  lines.push(`  设计理念：${data.visualDirection.concept}`);
  lines.push(`  构图与节奏：${data.visualDirection.composition}`);
  lines.push(`  视觉记忆点：${data.visualDirection.signature}`);

  lines.push('');

  for (const page of data.pages) {
    lines.push(`第 ${page.slideNumber} 页：${page.title}`);
    lines.push(`  主要内容：${page.content}`);
  }
  return lines.join('\n');
}

export class PptPlanTool extends BaseTool {
  readonly name = 'ppt_plan';
  readonly streaming = {
    emitPlaceholder: true,
    emitArgumentSnapshots: true,
  } as const;

  get description() {
    return [
      '生成 PPT 结构计划并呈现给用户审批。',
      '输出标题、受众、整稿视觉方向，以及每页标题和主要内容说明，供用户一次确认后再建稿。',
      '视觉方向只描述设计理念、构图节奏和唯一记忆点；不要填写最终颜色值、字体名或每页样式。',
      '本工具不创建 presentation，仅做规划。',
      '用户同意后，AI 使用 write_file 写入 .slides 文件建稿。',
    ].join(' ');
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: {
        type: 'string',
        description: 'PPT 标题。',
      },
      audience: {
        type: 'string',
        description: '目标受众，如"管理层"、"投资者"、"技术团队"。',
      },
      visualDirection: {
        type: 'object',
        additionalProperties: false,
        description: '整份文稿需要用户确认的最小视觉方向，不包含最终 theme 常量或逐页样式。',
        properties: {
          concept: {
            type: 'string',
            description: '整稿遵循什么设计理念，以及这种选择如何服务内容和受众。',
          },
          composition: {
            type: 'string',
            description: '整稿采用的构图、信息密度和页面节奏策略。',
          },
          signature: {
            type: 'string',
            description: '整稿唯一的核心视觉记忆点；不要罗列多种装饰。',
          },
        },
        required: ['concept', 'composition', 'signature'],
      },
      pages: {
        type: 'array',
        description: '逐页计划，每页包含标题和主要内容说明。',
        items: {
          type: 'object',
          additionalProperties: false,
          description: '单页计划。',
          properties: {
            title: { type: 'string', description: '该页标题。' },
            content: {
              type: 'string',
              description:
                '该页主要内容与排布说明，使用一段自然语言描述主要写什么、图表如何摆放、页面重点是什么。',
            },
          },
          required: ['title', 'content'],
        },
      },
    },
    required: ['title', 'visualDirection', 'pages'],
  };

  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    if (!Array.isArray(args.pages) || args.pages.length === 0) {
      return { success: false, error: buildInvalidPagesError(args.pages) };
    }

    const parsed = PptPlanToolArgsSchema.safeParse(args);
    if (parsed.success) return { success: true };
    return {
      success: false,
      error: `PPT_PLAN_ARGUMENTS_INVALID: ${parsed.error.issues
        .map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`)
        .join('; ')}`,
    };
  }

  getExecutionSummary(output: string): string {
    try {
      const result: unknown = JSON.parse(output);
      const data = isRecord(result) ? result.data : undefined;
      const parsed = PptPlanDataSchema.safeParse(data);
      if (!parsed.success) {
        return '规划 PPT';
      }
      return `已规划 "${parsed.data.title}"，共 ${parsed.data.pageCount} 页，等待用户确认`;
    } catch {
      return '规划 PPT';
    }
  }

  async run(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    const validation = this.validateArguments(args);
    if (!validation.success) {
      throw new Error(validation.error ?? 'ppt_plan: invalid arguments.');
    }

    const data = createPptPlanData(PptPlanToolArgsSchema.parse(args));

    const toolResult: StructuredToolResult<PptPlanData> = {
      data,
      observation: formatPlanForReview(data),
      control: {
        requireUser: true,
        resumeStrategy: 'continue',
      },
    };

    return JSON.stringify(toolResult);
  }
}
