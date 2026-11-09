import * as z from 'zod';
import {
  DirectionFontsSchema,
  DirectionPaletteSchema,
} from './designDirection/definitions/directionContract';

const NonEmptyTextSchema = z.string().trim().min(1);

/**
 * 新建整稿时由用户与 Agent 共同确认的最小视觉方向。
 *
 * 这里只保存设计判断；具体配色、字体和封面样张在 `look` 里。三个字段分别约束整体理念、
 * 构图方法和唯一记忆点，避免重新引入已经删除的宽泛 styleDecision。
 */
export const PptPlanVisualDirectionSchema = z.object({
  concept: NonEmptyTextSchema,
  composition: NonEmptyTextSchema,
  signature: NonEmptyTextSchema,
}).strict();

export type PptPlanVisualDirection = z.infer<typeof PptPlanVisualDirectionSchema>;

/**
 * 新建整稿时给用户看的“样子”：封面样张、配色与字体。
 *
 * Agent 先只做封面一页再调用 ppt_plan，`presentation` 指向这份文稿；工具取它当前成功版本，
 * 卡片按该版本渲染第 1 页。配色与字体是用户批准的内容，deck.js 的 `theme.direction` 照抄它们，
 * inspect 再逐页核对。
 */
const PaletteIdSchema = z.string().trim().min(1).max(80);

/** 计划卡上并列显示、用户可以换成的另一套配色；`id` 是 `linnya palette suggest` 给这一套的编号。 */
export const PptPlanPaletteOptionSchema = DirectionPaletteSchema.extend({
  id: PaletteIdSchema.optional(),
}).strict();
export type PptPlanPaletteOption = z.infer<typeof PptPlanPaletteOptionSchema>;

/** 选定的一套之外最多再列几套：配色建议一次最多给 5 套。 */
export const MAX_PLAN_PALETTE_ALTERNATIVES = 4;
const PaletteAlternativesSchema = z.array(PptPlanPaletteOptionSchema).min(1).max(MAX_PLAN_PALETTE_ALTERNATIVES);

export const PptPlanLookArgsSchema = z.object({
  presentation: z.string().trim().min(1),
  palette: DirectionPaletteSchema,
  /** 选定这一套在配色建议里的编号。 */
  paletteId: PaletteIdSchema.optional(),
  /** 配色建议里没选的几套，卡片与选定的一套并列显示。 */
  alternatives: PaletteAlternativesSchema.optional(),
  fonts: DirectionFontsSchema,
}).strict();

export type PptPlanLookArgs = z.infer<typeof PptPlanLookArgsSchema>;

/** 封面样张所在的文稿与成功版本；历史版本被清理后卡片只显示文字。 */
export const PptPlanCoverSchema = z.object({
  presentationId: NonEmptyTextSchema,
  versionId: NonEmptyTextSchema,
}).strict();

export type PptPlanCover = z.infer<typeof PptPlanCoverSchema>;

export const PptPlanLookDataSchema = z.object({
  palette: DirectionPaletteSchema,
  paletteId: PaletteIdSchema.optional(),
  alternatives: PaletteAlternativesSchema.optional(),
  fonts: DirectionFontsSchema,
  cover: PptPlanCoverSchema.optional(),
}).strict();

export type PptPlanLookData = z.infer<typeof PptPlanLookDataSchema>;

export const PptPlanToolPageArgsSchema = z.object({
  title: NonEmptyTextSchema,
  content: NonEmptyTextSchema,
}).strict();

/** Agent 调用 ppt_plan 时的正式参数。页数由 pages 唯一推导，不接受重复事实。 */
export const PptPlanToolArgsSchema = z.object({
  title: NonEmptyTextSchema,
  audience: NonEmptyTextSchema.optional(),
  visualDirection: PptPlanVisualDirectionSchema,
  look: PptPlanLookArgsSchema.optional(),
  pages: z.array(PptPlanToolPageArgsSchema).min(1),
}).strict();

export type PptPlanToolArgs = z.infer<typeof PptPlanToolArgsSchema>;

export const PptPlanPageDataSchema = PptPlanToolPageArgsSchema.extend({
  slideNumber: z.number().int().positive(),
}).strict();

/** backend、Conversation 工具结果和 Renderer 共用的唯一计划数据合同。 */
export const PptPlanDataSchema = z.object({
  title: NonEmptyTextSchema,
  pageCount: z.number().int().positive(),
  audience: NonEmptyTextSchema.optional(),
  visualDirection: PptPlanVisualDirectionSchema,
  look: PptPlanLookDataSchema.optional(),
  pages: z.array(PptPlanPageDataSchema).min(1),
}).strict().superRefine((plan, context) => {
  if (plan.pageCount !== plan.pages.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pageCount'],
      message: 'pageCount 必须与 pages 数量一致',
    });
  }

  plan.pages.forEach((page, index) => {
    if (page.slideNumber !== index + 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pages', index, 'slideNumber'],
        message: `slideNumber 必须为 ${index + 1}`,
      });
    }
  });
});

export type PptPlanPageData = z.infer<typeof PptPlanPageDataSchema>;
export type PptPlanData = z.infer<typeof PptPlanDataSchema>;

/** 从已经校验的 Agent 参数生成可持久化、可审批的顺序计划；封面版本由工具解析后传入。 */
export function createPptPlanData(input: PptPlanToolArgs, cover?: PptPlanCover): PptPlanData {
  return PptPlanDataSchema.parse({
    title: input.title,
    pageCount: input.pages.length,
    ...(input.audience === undefined ? {} : { audience: input.audience }),
    visualDirection: input.visualDirection,
    ...(input.look === undefined
      ? {}
      : {
          look: {
            palette: input.look.palette,
            ...(input.look.paletteId === undefined ? {} : { paletteId: input.look.paletteId }),
            ...(input.look.alternatives === undefined ? {} : { alternatives: input.look.alternatives }),
            fonts: input.look.fonts,
            ...(cover === undefined ? {} : { cover }),
          },
        }),
    pages: input.pages.map((page, index) => ({
      slideNumber: index + 1,
      title: page.title,
      content: page.content,
    })),
  });
}
