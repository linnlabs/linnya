import { isRecord } from '@plugin/slides/shared/valueRecord';
import { BaseTool, type ToolContext, type ToolParameterSchema } from '@plugin/backend/toolRuntime';
import type { StructuredToolResult } from '@plugin/backend/toolRuntime';
import { parseFileLocator } from '@app/schemas/file-locator';
import {
  createPptPlanData,
  PptPlanDataSchema,
  PptPlanToolArgsSchema,
  type PptPlanCover,
  type PptPlanData,
  type PptPlanLookArgs,
} from '@plugin/slides/shared/pptPlanToolContract';
import {
  getPresentationCoordinator,
  requirePresentationInspectTargetResolver,
} from './toolSupport';


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

function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return 'arguments';
  return path.reduce<string>((result, segment) => {
    return typeof segment === 'number'
      ? `${result}[${segment}]`
      : result.length === 0
        ? String(segment)
        : `${result}.${String(segment)}`;
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
  if (data.look) {
    const { palette, fonts } = data.look;
    lines.push(`  配色：底色 ${palette.backgrounds.join(' ')}；文字 ${palette.ink}；强调 ${palette.accents.join(' ')}`);
    lines.push(`  字体：${fonts.join('、')}`);
  }

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
      '视觉方向描述设计理念、构图节奏和唯一记忆点。',
      '新建整稿时先只写好封面一页并构建成功，再用 look 传这份文稿的 locator、全稿配色和字体：卡片会显示真实封面给用户看效果。',
      '编辑已有文稿或封面没做出来时可以不传 look。',
      '用户同意后继续写其余页，封面保留为第 1 页；theme.direction 的 palette、fonts 与批准的 look 一致。',
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
      look: {
        type: 'object',
        additionalProperties: false,
        description: '新建整稿时给用户看的样子：已构建的封面所在文稿、全稿配色与字体。',
        properties: {
          presentation: {
            type: 'string',
            description: '只写了封面一页的文稿 locator，例如 workspace:/储能投研.slides。',
          },
          palette: {
            type: 'object',
            additionalProperties: false,
            description: '全稿配色，与 deck.js 的 theme.direction.palette 一致。',
            properties: {
              backgrounds: {
                type: 'array', minItems: 1, maxItems: 4,
                description: '页面底色；第二个起可以是封面、章节页的反色底。',
                items: { type: 'string', description: '#RRGGBB。' },
              },
              ink: { type: 'string', description: '正文文字色，#RRGGBB。' },
              accents: {
                type: 'array', minItems: 1, maxItems: 5,
                description: '强调色。',
                items: { type: 'string', description: '#RRGGBB。' },
              },
            },
            required: ['backgrounds', 'ink', 'accents'],
          },
          fonts: {
            type: 'array', minItems: 1, maxItems: 6,
            description: '全稿用到的字体族名，与 theme.direction.fonts 一致。',
            items: { type: 'string', description: '字体族名。' },
          },
        },
        required: ['presentation', 'palette', 'fonts'],
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

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const validation = this.validateArguments(args);
    if (!validation.success) {
      throw new Error(validation.error ?? 'ppt_plan: invalid arguments.');
    }

    const input = PptPlanToolArgsSchema.parse(args);
    const cover = input.look ? await resolvePlanCover(input.look, context) : undefined;
    const data = createPptPlanData(input, cover?.cover);
    const coverNote = cover?.problem
      ? `\n\n封面样张没能显示（${cover.problem}），卡片只显示文字；修好封面后可以再调用一次 ppt_plan。`
      : '';

    const toolResult: StructuredToolResult<PptPlanData> = {
      data,
      observation: formatPlanForReview(data) + coverNote,
      control: {
        requireUser: true,
        resumeStrategy: 'continue',
      },
    };

    return JSON.stringify(toolResult);
  }
}

/**
 * 取封面样张所在文稿的当前成功版本。拿不到时只说明原因，不挡住审批：
 * 卡片退回只显示文字，Agent 可修好封面后再提交一次计划。
 */
async function resolvePlanCover(
  look: PptPlanLookArgs,
  context: ToolContext,
): Promise<{ readonly cover?: PptPlanCover; readonly problem?: string }> {
  const coordinator = getPresentationCoordinator(context);
  if (!coordinator) return { problem: '当前环境不能读取文稿' };
  try {
    const locator = parseFileLocator(look.presentation);
    if (locator.kind !== 'workspace') return { problem: 'look.presentation 必须是 workspace: locator' };
    const target = await requirePresentationInspectTargetResolver(context)({ path: locator.path });
    const inspection = await coordinator.inspectPresentation({
      presentationId: target.presentationId,
      selection: { kind: 'single', slideNumber: 1 },
      maxSlides: 1,
      includeHeuristics: false,
    });
    if (inspection.totalSlideCount === 0) return { problem: '文稿还没有页面' };
    return { cover: { presentationId: target.presentationId, versionId: inspection.versionId } };
  } catch (error) {
    return { problem: error instanceof Error ? error.message.slice(0, 160) : '读取文稿失败' };
  }
}
