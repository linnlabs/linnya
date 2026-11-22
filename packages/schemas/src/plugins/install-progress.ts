import * as z from 'zod';

/**
 * 远程安装进度事件（Host → Renderer）。安装开始时先发出 planned，列出本次真正需要下载的组件与字节数；
 * 已安装且校验通过的运行时不进入计划，界面据此计算总进度，不会因跳过组件而跳变。
 */
export const PluginInstallDownloadItemSchema = z.object({
  kind: z.enum(['runtime', 'plugin']),
  id: z.string().min(1),
  version: z.string().min(1),
  /** 开发用 latest.json 来源没有声明大小时为 null。 */
  totalBytes: z.number().int().nonnegative().nullable(),
});

export const PluginInstallProgressSchema = z.discriminatedUnion('stage', [
  z.object({ stage: z.literal('planned'), downloads: z.array(PluginInstallDownloadItemSchema) }),
  z.object({
    stage: z.literal('downloading'),
    item: PluginInstallDownloadItemSchema,
    receivedBytes: z.number().int().nonnegative(),
  }),
  /** 下载完成，正在解压、校验与落盘；此阶段不可取消。 */
  z.object({ stage: z.literal('installing'), item: PluginInstallDownloadItemSchema }),
]);

export const PluginInstallProgressEventSchema = z.object({
  pluginId: z.string().min(1),
  progress: PluginInstallProgressSchema,
});

export type PluginInstallDownloadItem = z.infer<typeof PluginInstallDownloadItemSchema>;
export type PluginInstallProgress = z.infer<typeof PluginInstallProgressSchema>;
export type PluginInstallProgressEvent = z.infer<typeof PluginInstallProgressEventSchema>;
