/**
 * PptDirectionTool
 *
 * 新建整稿前为本稿发出一个视觉方向：手法、配色逻辑、主色相、字体策略、图片策略与内容母题。
 * 方向由程序按场景权重、本机历史降权与同质化吸引子降权随机给出，Agent 只负责把它落到内容上。
 * 用户界面上它只是“构思视觉方向”的一步，不出现抽签说法。
 */

import { randomUUID } from 'node:crypto';
import { BaseTool, type ToolContext, type ToolParameterSchema } from '@plugin/backend/toolRuntime';
import {
  buildDirectionHistory,
  DIRECTION_BOLDNESS,
  DIRECTION_SCENARIOS,
  drawDirections,
  formatDirectionDrawForAgent,
  PptDirectionToolArgsSchema,
  PptDirectionToolResultSchema,
  type DirectionHistory,
  type PptDirectionToolResult,
} from '@plugin/slides/shared/designDirection';
import { getPresentationCoordinator } from './toolSupport';

/** 降权窗口覆盖最近 15 份；多读一些，留给以后调整窗口。 */
const HISTORY_LIMIT = 30;

export class PptDirectionTool extends BaseTool {
  readonly name = 'ppt_direction';

  get description() {
    return [
      '新建整份演示文稿、且用户没有指定风格、品牌、模板或参考稿时，在 ppt_plan 之前调用一次，取得本稿的视觉方向。',
      '传入场景和 3–12 个从内容里提炼的具体母题（每个附 0–1 的常见度，越是同类稿子都会用的越接近 1）。',
      '返回手法、配色逻辑、主色相、字体与图片策略和一个母题，以及在 deck.js 里声明 theme.direction 的方法。',
      '方向明显不适合内容时，可以带 rejected（cardId 与理由）再调用一次换一个；编辑已有文稿时不要调用。',
    ].join(' ');
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      scenario: {
        type: 'string',
        enum: [...DIRECTION_SCENARIOS],
        description: '用途：business 商务汇报、teaching 教学课件、culture 文化讲座、product 产品发布、academic 学术报告、personal 个人分享。',
      },
      boldness: {
        type: 'string',
        enum: [...DIRECTION_BOLDNESS],
        description: '可选。steady 稳妥、balanced 适中、bold 大胆。用户没有表态时不传，按场景默认。',
      },
      motifs: {
        type: 'array',
        minItems: 3,
        maxItems: 12,
        description: '从内容里提炼的具体视觉母题，例如“饕餮纹的对称展开”“电芯的卷绕截面”，不要写“科技感”这类形容词。',
        items: {
          type: 'object',
          description: '一个内容母题。',
          additionalProperties: false,
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 80, description: '母题，一句具体的话。' },
            typicality: { type: 'number', minimum: 0, maximum: 1, description: '同类稿子里有多常见：0 很少见，1 人人都用。' },
          },
          required: ['text', 'typicality'],
        },
      },
      rejected: {
        type: 'array',
        maxItems: 5,
        description: '可选。上一次给出的手法确实不适合本稿时填写，程序换一个。',
        items: {
          type: 'object',
          description: '一次退回。',
          additionalProperties: false,
          properties: {
            cardId: { type: 'string', minLength: 1, description: '上一次结果里的 cardId。' },
            reason: { type: 'string', minLength: 4, maxLength: 200, description: '为什么不适合这份内容。' },
          },
          required: ['cardId', 'reason'],
        },
      },
    },
    required: ['scenario', 'motifs'],
  };

  protected override validateArguments(args: Record<string, unknown>): { success: boolean; error?: string } {
    const parsed = PptDirectionToolArgsSchema.safeParse(args);
    if (parsed.success) return { success: true };
    return {
      success: false,
      error: `PPT_DIRECTION_ARGUMENTS_INVALID: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
        .join('; ')}`,
    };
  }

  getExecutionSummary(output: string): string {
    try {
      const { data } = PptDirectionToolResultSchema.parse(JSON.parse(output));
      return `ppt_direction：${data.card.name}（${data.drawId}）`;
    } catch {
      return 'ppt_direction：结果无法解析。';
    }
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const input = PptDirectionToolArgsSchema.parse(args);
    const history = await readHistory(context);
    const rejectedCardIds = input.rejected?.map((entry) => entry.cardId) ?? [];
    const seed = input.seed ?? randomUUID().slice(0, 8);
    const [draw] = drawDirections({
      scenario: input.scenario,
      ...(input.boldness ? { boldness: input.boldness } : {}),
      motifs: input.motifs,
      seed,
      history,
      excludeCardIds: rejectedCardIds,
    });
    if (draw == null) {
      throw new Error(`PPT_DIRECTION_POOL_EMPTY: 场景 ${input.scenario} 没有可用的方向。`);
    }

    const result: PptDirectionToolResult = {
      data: {
        drawId: draw.drawId,
        poolVersion: draw.poolVersion,
        scenario: draw.scenario,
        boldness: draw.boldness,
        card: { id: draw.card.id, name: draw.card.name, family: draw.card.family },
        colorLogic: draw.colorLogic.id,
        hueBin: draw.hue?.bin ?? null,
        typeStrategy: draw.typeStrategy.id,
        imageStrategy: draw.imageStrategy.id,
        motif: draw.motif,
        rejectedCardIds,
      },
      observation: formatDirectionDrawForAgent(draw),
    };
    return JSON.stringify(PptDirectionToolResultSchema.parse(result));
  }
}

/** 本机历史读不到时按无历史处理：降权只是优化，不能挡住建稿。 */
async function readHistory(context: ToolContext): Promise<DirectionHistory> {
  try {
    const uses = await getPresentationCoordinator(context)?.listRecentDirectionUses?.(HISTORY_LIMIT);
    return buildDirectionHistory(uses ?? []);
  } catch {
    return { cardIds: [], hueBins: [] };
  }
}
