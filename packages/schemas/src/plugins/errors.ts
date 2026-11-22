import * as z from 'zod';

/** 插件生命周期操作对用户可见的稳定错误类别；原始异常只留在 Host 诊断日志。 */
export const PluginOperationErrorCodeSchema = z.enum([
  'artifact-integrity',
  'version-conflict',
  'migration-failed',
  'incompatible',
  'disk-space',
  'source-unavailable',
  /** 传输过程中连接失败或中断；与服务端明确拒绝（source-unavailable）区分，便于提示用户检查网络。 */
  'network',
  /** 用户主动取消；已下载的临时内容已丢弃。 */
  'cancelled',
  'active-tool',
  'unknown',
]);

export type PluginOperationErrorCode = z.infer<typeof PluginOperationErrorCodeSchema>;

/** 磁盘空间不足时的实际数字，供界面写明“需要多少、还剩多少”。 */
export const PluginDiskSpaceShortfallSchema = z.object({
  requiredBytes: z.number().int().nonnegative(),
  availableBytes: z.number().int().nonnegative(),
});

export const PluginOperationFailureSchema = z.object({
  code: PluginOperationErrorCodeSchema,
  pluginId: z.string().min(1).optional(),
  diskSpace: PluginDiskSpaceShortfallSchema.optional(),
});

export type PluginDiskSpaceShortfall = z.infer<typeof PluginDiskSpaceShortfallSchema>;

export type PluginOperationFailure = z.infer<typeof PluginOperationFailureSchema>;

export function isPluginOperationFailure(value: unknown): value is PluginOperationFailure {
  return PluginOperationFailureSchema.safeParse(value).success;
}
