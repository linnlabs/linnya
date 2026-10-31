import { z } from 'zod';

const InternalStoragePathSchema = z.string().min(1).refine(
  value => !value.includes('\0'),
  'internal storage paths must not contain NUL',
);

/**
 * Host 冻结内部存储位置，runner 只执行这份边界，不从自己的 cwd 或环境重新猜路径。
 * 当前会话工作目录由 launch 单独提供；readable_roots 只允许受管 CLI 等只读运行资源。
 */
export const CommandInternalStorageBoundarySchema = z.object({
  protected_roots: z.array(InternalStoragePathSchema).min(1),
  readable_roots: z.array(InternalStoragePathSchema),
}).strict();

export type CommandInternalStorageBoundary = z.infer<
  typeof CommandInternalStorageBoundarySchema
>;
