import { z } from 'zod';

import {
  PLUGIN_CLI_MAX_ARG_COUNT,
  PLUGIN_CLI_MAX_ARG_LENGTH,
} from 'src/app-hosts/linnya/application/plugin-cli-shell-bridge';

// 与 Shell 桥协议同一组上限：同一插件命令不能因为入口不同而接受不同的参数。
const PluginCliToolArgumentsSchema = z.object({
  plugin_id: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/u),
  argv: z.array(
    z.string()
      .max(PLUGIN_CLI_MAX_ARG_LENGTH)
      .refine(value => !value.includes('\0'), 'plugin CLI arguments must not contain NUL'),
  ).max(PLUGIN_CLI_MAX_ARG_COUNT),
}).strict();

export type PluginCliToolArguments = z.infer<typeof PluginCliToolArgumentsSchema>;

export function parsePluginCliToolArguments(
  args: unknown,
): { readonly success: true; readonly value: PluginCliToolArguments } | { readonly success: false; readonly error: string } {
  const parsed = PluginCliToolArgumentsSchema.safeParse(args);
  if (parsed.success) return { success: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue?.path.join('.') || 'arguments';
  return { success: false, error: `plugin_cli ${field}: ${issue?.message ?? 'invalid arguments'}` };
}
