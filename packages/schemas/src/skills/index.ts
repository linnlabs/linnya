import { z } from 'zod';

export const SkillNameSchema = z.string().min(1).max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const SkillRelativePathSchema = z.string().min(1).max(500);
const named = { name: SkillNameSchema };
const file = { ...named, path: SkillRelativePathSchema };

/** 当前文件就是数据；expected_content 只防止覆盖刚发生的编辑，不建立版本。 */
export const SkillManagementRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('read'), ...file, source: z.enum(['builtin', 'plugin', 'user']).optional() }).strict(),
  z.object({ action: z.literal('validate'), source_directory: z.string().min(1) }).strict(),
  z.object({ action: z.literal('install'), ...named, source_directory: z.string().min(1) }).strict(),
  z.object({ action: z.literal('update'), ...named, source_directory: z.string().min(1) }).strict(),
  z.object({ action: z.literal('remove'), ...named }).strict(),
  z.object({ action: z.literal('write'), ...file, content: z.string().max(524288),
    expected_content: z.string().max(524288).nullable().default(null) }).strict(),
  z.object({ action: z.literal('edit'), ...file, old_string: z.string().min(1).max(524288),
    new_string: z.string().max(524288) }).strict(),
  z.object({ action: z.literal('delete_file'), ...file }).strict(),
]);
export type SkillManagementRequest = z.infer<typeof SkillManagementRequestSchema>;

export const ManagedSkillSchema = z.object({
  name: z.string(), description: z.string(), source: z.enum(['builtin', 'plugin', 'user']),
  available: z.boolean(), error: z.string().optional(), files: z.array(z.string()),
}).strict();
export type ManagedSkill = z.infer<typeof ManagedSkillSchema>;

export const SkillManagementResultSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), skills: z.array(ManagedSkillSchema) }).strict(),
  z.object({ action: z.literal('read'), name: z.string(), path: z.string(), content: z.string(),
    source: z.enum(['builtin', 'plugin', 'user']) }).strict(),
  z.object({ action: z.literal('validate'), name: z.string(), files: z.array(z.string()) }).strict(),
  ...(['install', 'update', 'remove', 'write', 'edit', 'delete_file'] as const).map(action =>
    z.object({ action: z.literal(action), name: z.string() }).strict()),
]);
export type SkillManagementResult = z.infer<typeof SkillManagementResultSchema>;
export const SkillManagementErrorSchema = z.object({
  code: z.enum(['invalid_skill', 'not_found', 'conflict', 'read_only', 'write_failed']),
  message: z.string(),
}).strict();
export type SkillManagementErrorCode = z.infer<typeof SkillManagementErrorSchema>['code'];
