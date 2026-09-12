import { z } from 'zod';

const OpaqueIdSchema = z.string().trim().min(1);
const DiagnosticCountsSchema = z.object({
  error: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
}).strict();

/** 安全审计不接纳诊断 code/message/target；只描述成功保存时已经可见的诊断数。 */
export const ConversationControlAuditWorkspaceDocumentsSchema = z.object({
  observations: z.number().int().nonnegative(),
  observations_with_errors: z.number().int().nonnegative(),
  observations_with_warnings: z.number().int().nonnegative(),
  visible: DiagnosticCountsSchema,
  truncated_count: z.number().int().nonnegative(),
  by_observation: z.array(z.object({
    run_id: OpaqueIdSchema,
    parent_run_id: OpaqueIdSchema.optional(),
    tool_call_id: OpaqueIdSchema,
    tool_name: z.enum(['write_file', 'edit_file']),
    emitted_at: z.number().finite().nonnegative(),
    visible: DiagnosticCountsSchema,
    truncated_count: z.number().int().nonnegative(),
  }).strict()),
}).strict();
