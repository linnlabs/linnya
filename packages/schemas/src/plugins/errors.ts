import * as z from 'zod';

/** 插件生命周期操作对用户可见的稳定错误类别；原始异常只留在 Host 诊断日志。 */
export const PluginOperationErrorCodeSchema = z.enum([
  'artifact-integrity',
  'version-conflict',
  'migration-failed',
  'incompatible',
  'disk-space',
  'source-unavailable',
  'active-tool',
  'unknown',
]);

export type PluginOperationErrorCode = z.infer<typeof PluginOperationErrorCodeSchema>;

export const PluginOperationFailureSchema = z.object({
  code: PluginOperationErrorCodeSchema,
  pluginId: z.string().min(1).optional(),
});

export type PluginOperationFailure = z.infer<typeof PluginOperationFailureSchema>;

export function isPluginOperationFailure(value: unknown): value is PluginOperationFailure {
  return PluginOperationFailureSchema.safeParse(value).success;
}
