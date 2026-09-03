import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();

export const SkillActionSchema = z.enum(['activate', 'read_resource', 'list_resources']);
export type SkillAction = z.infer<typeof SkillActionSchema>;

export const SkillArgsSchema = z.object({
  action: SkillActionSchema,
  skill_name: NonEmptyStringSchema,
  resource_path: NonEmptyStringSchema.optional(),
  offset: z.number().int().optional(),
  limit: z.number().int().optional(),
}).strict().superRefine((args, context) => {
  if (args.action === 'read_resource' && !args.resource_path) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resource_path'],
      message: 'resource_path is required for read_resource',
    });
  }
});

export const SkillActivateResultSchema = z.object({
  data: z.object({
    skill_name: NonEmptyStringSchema,
    source: z.enum(['builtin', 'plugin', 'user']),
    activated: z.literal(true),
    resource_count: NonNegativeIntegerSchema,
  }).strict(),
  observation: NonEmptyStringSchema,
}).strict();

export const SkillReadResourceResultSchema = z.object({
  data: z.object({
    skill_name: NonEmptyStringSchema,
    resource_path: NonEmptyStringSchema,
    total_lines: PositiveIntegerSchema,
    start_line: PositiveIntegerSchema,
    end_line: NonNegativeIntegerSchema,
    is_truncated: z.boolean(),
  }).strict(),
  observation: NonEmptyStringSchema,
}).strict();

export const SkillListResourcesResultSchema = z.object({
  data: z.object({
    skill_name: NonEmptyStringSchema,
    resources: z.array(NonEmptyStringSchema),
  }).strict(),
  observation: NonEmptyStringSchema,
}).strict();

export const SkillResultSchema = z.union([
  SkillActivateResultSchema,
  SkillReadResourceResultSchema,
  SkillListResourcesResultSchema,
]);

export const SkillResourceUriSchema = z.string()
  .regex(/^skill:\/\/skills\/[^/]+\/.+$/);

/** 历史 resource_read(skill://...) 结果；仅供 Renderer replay admission。 */
export const HistoricalSkillResourceReadResultSchema = z.object({
  data: z.object({
    skill_name: NonEmptyStringSchema,
    resource_path: NonEmptyStringSchema,
    uri: SkillResourceUriSchema,
    total_lines: PositiveIntegerSchema,
    start_line: PositiveIntegerSchema,
    end_line: NonNegativeIntegerSchema,
    next_offset: PositiveIntegerSchema.nullable(),
    is_truncated: z.boolean(),
    content: z.string(),
  }).strict(),
  observation: NonEmptyStringSchema,
  observationPreviewMeta: z.object({
    document_name: NonEmptyStringSchema,
  }).strict(),
}).strict();

export type SkillResult = z.infer<typeof SkillResultSchema>;
export type HistoricalSkillResourceReadResult = z.infer<typeof HistoricalSkillResourceReadResultSchema>;
