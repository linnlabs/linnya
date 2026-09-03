import { z } from 'zod';

const NonEmptyTextSchema = z.string().trim().min(1);

export const AskQuestionOptionSchema = z.object({
  id: NonEmptyTextSchema,
  label: NonEmptyTextSchema,
  description: z.string().optional(),
}).strict();
export type AskQuestionOption = z.infer<typeof AskQuestionOptionSchema>;

export const AskQuestionSchema = z.object({
  id: NonEmptyTextSchema,
  type: z.enum(['single', 'multi', 'text']),
  question: NonEmptyTextSchema,
  options: z.array(AskQuestionOptionSchema).max(7).optional(),
  allowOther: z.boolean().optional(),
  required: z.boolean().optional(),
  maxSelect: z.number().int().positive().optional(),
  defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
}).strict().superRefine((question, context) => {
  const options = question.options ?? [];
  if ((question.type === 'single' || question.type === 'multi') && options.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['options'],
      message: `${question.type} question requires at least one option`,
    });
  }

  const optionIds = new Set<string>();
  for (const [index, option] of options.entries()) {
    if (optionIds.has(option.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options', index, 'id'],
        message: `Duplicate option id: ${option.id}`,
      });
    }
    optionIds.add(option.id);
  }

  if (question.maxSelect !== undefined) {
    if (question.type !== 'multi') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxSelect'],
        message: 'maxSelect is only valid for multi questions',
      });
    } else if (question.maxSelect > options.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxSelect'],
        message: 'maxSelect cannot exceed the number of options',
      });
    }
  }

  if (question.defaultValue !== undefined) {
    const expectsArray = question.type === 'multi';
    if (expectsArray !== Array.isArray(question.defaultValue)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultValue'],
        message: expectsArray
          ? 'multi question defaultValue must be an array'
          : `${question.type} question defaultValue must be a string`,
      });
    }
  }
});
export type AskQuestion = z.infer<typeof AskQuestionSchema>;

const AskCommonSchema = z.object({
  questions: z.array(AskQuestionSchema).min(1).max(10),
  title: z.string().optional(),
  description: z.string().optional(),
  submitLabel: z.string().optional(),
}).strict().superRefine((input, context) => {
  const questionIds = new Set<string>();
  for (const [index, question] of input.questions.entries()) {
    if (questionIds.has(question.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questions', index, 'id'],
        message: `Duplicate question id: ${question.id}`,
      });
    }
    questionIds.add(question.id);
  }
});

/** ask 工具接收的正式参数合同。 */
export const AskInputSchema = AskCommonSchema;
export type AskInput = z.infer<typeof AskInputSchema>;

/** 流式调用只确定工具名、尚未形成完整 arguments 时的唯一占位合同。 */
export const AskPlaceholderArgsSchema = z.object({}).strict();

/** ask 成功结果中 `data` 的正式合同。 */
export const QuestionnaireDataSchema = z.object({
  questionnaireId: NonEmptyTextSchema,
  title: z.string().optional(),
  description: z.string().optional(),
  allowSkip: z.boolean(),
  submitLabel: NonEmptyTextSchema,
  skipLabel: z.string().optional(),
  questions: z.array(AskQuestionSchema).min(1).max(10),
}).strict().superRefine((data, context) => {
  const questionIds = new Set<string>();
  for (const [index, question] of data.questions.entries()) {
    if (questionIds.has(question.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questions', index, 'id'],
        message: `Duplicate question id: ${question.id}`,
      });
    }
    questionIds.add(question.id);
  }
});
export type QuestionnaireData = z.infer<typeof QuestionnaireDataSchema>;

export const QuestionnaireAnswersSchema = z.object({
  answers: z.record(z.string()),
  multiAnswers: z.record(z.array(z.string())),
  textAnswers: z.record(z.string()),
  otherAnswers: z.record(z.string()),
}).strict();
export type QuestionnaireAnswers = z.infer<typeof QuestionnaireAnswersSchema>;

export const AskResultSchema = z.object({
  data: QuestionnaireDataSchema,
  observation: NonEmptyTextSchema,
  control: z.object({
    requireUser: z.literal(true),
    questionnaireId: NonEmptyTextSchema,
    resumeStrategy: z.literal('continue'),
  }).strict(),
}).strict().superRefine((result, context) => {
  if (result.data.questionnaireId !== result.control.questionnaireId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['control', 'questionnaireId'],
      message: 'Questionnaire result and control identities must match',
    });
  }
});
export type AskResult = z.infer<typeof AskResultSchema>;
