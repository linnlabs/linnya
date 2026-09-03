import { z } from 'zod';

const NonEmptyTextSchema = z.string().trim().min(1);
const PositiveIntegerSchema = z.number().int().positive();
const NonNegativeIntegerSchema = z.number().int().nonnegative();

/**
 * ppt_inspect 的插件公共入参合同。
 *
 * backend 的 ToolNode admission 与工具直接执行都必须使用同一 parser，避免模型合同、
 * 执行时序和业务校验各自维护一套规则。
 */
export const PptInspectToolArgsSchema = z.object({
  presentation_id: NonEmptyTextSchema.optional(),
  locator: NonEmptyTextSchema.optional(),
  inode: NonEmptyTextSchema.optional(),
  slideNumber: PositiveIntegerSchema.optional(),
  endSlide: PositiveIntegerSchema.optional(),
  heuristics: z.boolean().optional(),
}).strict().superRefine((input, context) => {
  const selectors = [input.presentation_id, input.locator, input.inode]
    .filter((value): value is string => value !== undefined);
  if (selectors.length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['presentation_id'],
      message: 'presentation_id、locator、inode 必须且只能提供一个',
    });
  }

  if (input.endSlide !== undefined && input.slideNumber === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endSlide'],
      message: 'endSlide 只能与 slideNumber 同时提供',
    });
  } else if (
    input.endSlide !== undefined
    && input.slideNumber !== undefined
    && input.endSlide < input.slideNumber
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endSlide'],
      message: 'endSlide 不能小于 slideNumber',
    });
  }
});

export type PptInspectToolArgs = z.infer<typeof PptInspectToolArgsSchema>;

const PptInspectArtifactSchema = z.object({
  presentationId: NonEmptyTextSchema,
  versionId: NonEmptyTextSchema,
  slideCount: NonNegativeIntegerSchema,
}).strict();

const PptInspectDocumentSchema = z.object({
  title: NonEmptyTextSchema,
  locator: NonEmptyTextSchema.optional(),
  inode: NonEmptyTextSchema.optional(),
}).strict();

const PptInspectSelectionSchema = z.object({
  requestedSlideNumbers: z.array(PositiveIntegerSchema),
  shownSlideNumbers: z.array(PositiveIntegerSchema),
  truncated: z.boolean(),
}).strict();

const PptInspectPageSchema = z.object({
  slideNumber: PositiveIntegerSchema,
  layoutKey: NonEmptyTextSchema,
  elementCount: NonNegativeIntegerSchema,
  editableTargetCount: NonNegativeIntegerSchema,
}).strict();

const PptInspectFindingSummarySchema = z.object({
  rawFindingCount: NonNegativeIntegerSchema,
  uniqueFindingCount: NonNegativeIntegerSchema,
  rootGroupCount: NonNegativeIntegerSchema,
  p0Count: NonNegativeIntegerSchema,
  p1Count: NonNegativeIntegerSchema,
  p2Count: NonNegativeIntegerSchema,
}).strict().superRefine((summary, context) => {
  if (summary.uniqueFindingCount > summary.rawFindingCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['uniqueFindingCount'],
      message: 'uniqueFindingCount 不能大于 rawFindingCount',
    });
  }
  if (summary.rootGroupCount > summary.uniqueFindingCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rootGroupCount'],
      message: 'rootGroupCount 不能大于 uniqueFindingCount',
    });
  }
  if (summary.p0Count + summary.p1Count + summary.p2Count !== summary.uniqueFindingCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['p0Count'],
      message: 'P0、P1、P2 计数之和必须等于 uniqueFindingCount',
    });
  }
});

export const PptInspectToolDataSchema = z.object({
  artifact: PptInspectArtifactSchema,
  document: PptInspectDocumentSchema,
  selection: PptInspectSelectionSchema,
  pages: z.array(PptInspectPageSchema),
  buildStatus: z.object({ state: z.literal('ready') }).strict(),
  findingSummary: PptInspectFindingSummarySchema,
}).strict().superRefine((data, context) => {
  const pageNumbers = data.pages.map((page) => page.slideNumber);
  if (!sameNumbers(pageNumbers, data.selection.shownSlideNumbers)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['selection', 'shownSlideNumbers'],
      message: 'shownSlideNumbers 必须与 pages 的页码和顺序一致',
    });
  }

  const requested = new Set(data.selection.requestedSlideNumbers);
  if (data.selection.shownSlideNumbers.some((slideNumber) => !requested.has(slideNumber))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['selection', 'shownSlideNumbers'],
      message: 'shownSlideNumbers 必须来自 requestedSlideNumbers',
    });
  }
});

const PptInspectObservationSchema = z.string().refine((value) => value.trim().length > 0, {
  message: 'observation 必须包含非空白内容',
});

const PptInspectObservationPreviewMetaSchema = z.object({
  document_name: NonEmptyTextSchema,
  doc_type: z.literal('slides/inspection'),
}).strict();

/** Conversation 工具消息持久化后，Renderer 实际收到的严格结果合同。 */
export const PptInspectToolMessageResultSchema = z.object({
  data: PptInspectToolDataSchema,
  observation: PptInspectObservationSchema,
}).strict();

/** 工具执行期结果；preview meta 由 ToolNode 消费，不进入 Conversation 工具消息。 */
export const PptInspectToolResultSchema = PptInspectToolMessageResultSchema.extend({
  observationPreviewMeta: PptInspectObservationPreviewMetaSchema,
});

export type PptInspectToolData = z.infer<typeof PptInspectToolDataSchema>;
export type PptInspectToolMessageResult = z.infer<typeof PptInspectToolMessageResultSchema>;
export type PptInspectToolResult = z.infer<typeof PptInspectToolResultSchema>;

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}
