/** ask live 调用的输入合同与推导类型。 */
import { z } from 'zod';

export const ASK_TOOL_MAX_QUESTIONS = 10;
export const ASK_TOOL_MAX_OPTIONS = 7;
export const ASK_TOOL_MIN_MULTI_SELECTIONS = 2;

const NonEmptyTextSchema = z.string().trim().min(1);

const AskToolQuestionOptionSchema = z.object({
  id: NonEmptyTextSchema,
  label: NonEmptyTextSchema,
  description: z.string().optional(),
}).strict();

const AskToolChoiceOptionsSchema = z.array(AskToolQuestionOptionSchema)
  .min(1)
  .max(ASK_TOOL_MAX_OPTIONS)
  .superRefine((options, context) => {
    const optionIds = new Set<string>();
    options.forEach((option, index) => {
      if (optionIds.has(option.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: `Duplicate option id: ${option.id}`,
        });
      }
      optionIds.add(option.id);
    });
  });

const AskToolQuestionBaseShape = {
  id: NonEmptyTextSchema,
  question: NonEmptyTextSchema,
  required: z.boolean().optional(),
};

const AskToolSingleQuestionSchema = z.object({
  ...AskToolQuestionBaseShape,
  type: z.literal('single'),
  options: AskToolChoiceOptionsSchema,
  allowOther: z.boolean().optional(),
}).strict();

const AskToolMultiQuestionSchema = z.object({
  ...AskToolQuestionBaseShape,
  type: z.literal('multi'),
  options: AskToolChoiceOptionsSchema,
  allowOther: z.boolean().optional(),
  maxSelect: z.number()
    .int()
    .min(ASK_TOOL_MIN_MULTI_SELECTIONS)
    .max(ASK_TOOL_MAX_OPTIONS)
    .optional(),
}).strict();

const AskToolTextQuestionSchema = z.object({
  ...AskToolQuestionBaseShape,
  type: z.literal('text'),
}).strict();

export const AskToolQuestionSchema = z.discriminatedUnion('type', [
  AskToolSingleQuestionSchema,
  AskToolMultiQuestionSchema,
  AskToolTextQuestionSchema,
]);
export type AskToolQuestion = z.infer<typeof AskToolQuestionSchema>;

/**
 * live ask 的正式输入合同。
 *
 * 共享 AskInputSchema 还负责历史事件回放，因此 live 调用在工具 feature 内使用更窄的判别联合：
 * single/text 从结构上没有 maxSelect，multi 才能声明 2 到 7 的选择上限。
 */
export const AskToolInputSchema = z.object({
  questions: z.array(AskToolQuestionSchema).min(1).max(ASK_TOOL_MAX_QUESTIONS),
  title: z.string().optional(),
  description: z.string().optional(),
  submitLabel: z.string().optional(),
}).strict().superRefine((input, context) => {
  const questionIds = new Set<string>();
  input.questions.forEach((question, index) => {
    if (questionIds.has(question.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questions', index, 'id'],
        message: `Duplicate question id: ${question.id}`,
      });
    }
    questionIds.add(question.id);

    if (
      question.type === 'multi'
      && question.maxSelect !== undefined
      && question.maxSelect > question.options.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questions', index, 'maxSelect'],
        message: 'maxSelect cannot exceed the number of options',
      });
    }
  });
});
