import { z } from 'zod';

const NonEmptyTextSchema = z.string().trim().min(1);

/**
 * 新建整稿时由用户与 Agent 共同确认的最小视觉方向。
 *
 * 这里只保存设计判断，不复制最终 deck.js 的颜色、字体或图表调色板；后者仍由
 * `compose({ theme })` 拥有。三个字段分别约束整体理念、构图方法和唯一记忆点，避免重新
 * 引入已经删除的宽泛 styleDecision。
 */
export const PptPlanVisualDirectionSchema = z.object({
  concept: NonEmptyTextSchema,
  composition: NonEmptyTextSchema,
  signature: NonEmptyTextSchema,
}).strict();

export type PptPlanVisualDirection = z.infer<typeof PptPlanVisualDirectionSchema>;

export const PptPlanToolPageArgsSchema = z.object({
  title: NonEmptyTextSchema,
  content: NonEmptyTextSchema,
}).strict();

/** Agent 调用 ppt_plan 时的正式参数。页数由 pages 唯一推导，不接受重复事实。 */
export const PptPlanToolArgsSchema = z.object({
  title: NonEmptyTextSchema,
  audience: NonEmptyTextSchema.optional(),
  visualDirection: PptPlanVisualDirectionSchema,
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

/** 从已经校验的 Agent 参数生成可持久化、可审批的顺序计划。 */
export function createPptPlanData(input: PptPlanToolArgs): PptPlanData {
  return PptPlanDataSchema.parse({
    title: input.title,
    pageCount: input.pages.length,
    ...(input.audience === undefined ? {} : { audience: input.audience }),
    visualDirection: input.visualDirection,
    pages: input.pages.map((page, index) => ({
      slideNumber: index + 1,
      title: page.title,
      content: page.content,
    })),
  });
}
