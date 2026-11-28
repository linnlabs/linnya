import * as z from 'zod';

/**
 * plugin_cli 工具的结果数据。Host 工具写出它，linnya 命令行读取 stdout，把插件报告的
 * conversation:/ 产物换成本机路径。
 *
 * 这里刻意不放会话目录或任何本机绝对路径：工具结果会写进事件并投影到界面，本机路径只在
 * tools call 的命令行回执里给调用方。
 */
export const PluginCliToolResultDataSchema = z.object({
  plugin_id: z.string().min(1),
  argv: z.array(z.string()),
  exit_code: z.number().int().min(0).max(255),
  /** 插件的报告；Linnya 官方插件都输出一个 JSON 报告，产物是其中完整的 conversation:/ 字符串值。 */
  stdout: z.string(),
  stderr: z.string(),
}).strict();
export type PluginCliToolResultData = z.infer<typeof PluginCliToolResultDataSchema>;

/** 工具结构化结果：data 之外的 observation 是给模型看的文字投影。 */
export const PluginCliToolStructuredResultSchema = z.object({
  data: PluginCliToolResultDataSchema,
  observation: z.string(),
}).strict();
export type PluginCliToolStructuredResult = z.infer<typeof PluginCliToolStructuredResultSchema>;

/**
 * 界面在运行中、失败时只能读到调用参数，用它显示命令行。参数校验（ID 格式、个数与长度上限）
 * 仍归 Host 工具；这里只认展示需要的两个字段，读不出时界面不显示命令。
 */
export const PluginCliToolDisplayArgsSchema = z.object({
  plugin_id: z.string().min(1),
  argv: z.array(z.string()),
});
export type PluginCliToolDisplayArgs = z.infer<typeof PluginCliToolDisplayArgsSchema>;
