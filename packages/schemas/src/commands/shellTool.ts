import { z } from 'zod';

import {
  ShellCommandTextSchema,
  ShellWorkingDirectorySchema,
} from './shellCommandProposal';

export const SHELL_INITIAL_WAIT_DEFAULT_MS = 10_000;
export const SHELL_INITIAL_WAIT_MIN_MS = 250;
export const SHELL_INITIAL_WAIT_MAX_MS = 30_000;
export const WINDOWS_SHELL_INITIAL_WAIT_FLOOR_MS = 10_000;
export const SHELL_HARD_TIMEOUT_DEFAULT_SECONDS = 180;
export const SHELL_HARD_TIMEOUT_MIN_SECONDS = 1;
export const SHELL_HARD_TIMEOUT_MAX_SECONDS = 600;

/**
 * 这里只包含 Agent 可以决定的输入。执行身份、权限、process handle、Shell 路径和环境
 * 均由 host 注入。hard timeout 使用秒作为 Agent 友好的输入单位，host 会在启动前
 * 转为毫秒并冻结进 launch；它不影响 initial wait 的返回时机。
 */
export const ShellToolArgumentsV1Schema = z.object({
  command: ShellCommandTextSchema,
  cwd: ShellWorkingDirectorySchema.optional(),
  /** 缺省为普通 pipe；只有 Agent 明确请求交互时，host 才创建本次 run 的 PTY。 */
  interactive: z.boolean().optional(),
  /** Agent 明知本条会写文件时显式声明；只读档由 host 审批，不能直接指定最终权限。 */
  requires_write_access: z.boolean().optional(),
  initial_wait_ms: z.number().int()
    .min(SHELL_INITIAL_WAIT_MIN_MS)
    .max(SHELL_INITIAL_WAIT_MAX_MS)
    .safe()
    .optional(),
  hard_timeout_seconds: z.number().int()
    .min(SHELL_HARD_TIMEOUT_MIN_SECONDS)
    .max(SHELL_HARD_TIMEOUT_MAX_SECONDS)
    .safe()
    .optional(),
}).strict();
export type ShellToolArgumentsV1 = z.infer<typeof ShellToolArgumentsV1Schema>;

export function parseShellToolArguments(value: unknown): ShellToolArgumentsV1 {
  return ShellToolArgumentsV1Schema.parse(value);
}
