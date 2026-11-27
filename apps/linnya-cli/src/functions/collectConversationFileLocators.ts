import path from 'node:path';

import {
  ConversationFileLocatorSchema,
  PluginCliToolResultDataSchema,
  parseFileLocator,
} from '@app/schemas';

export interface ConversationFileCandidate {
  readonly locator: string;
  readonly path: string;
}

/**
 * plugin_cli 的插件把写出的文件报告在 stdout 的 JSON 报告里，每个文件是一个完整的
 * conversation:/ 字符串值。外部调用方读不到 Linnya 的会话目录约定，这里按 Host 回执给出的
 * 目录把它们换成本机路径。
 *
 * 只认完整字符串值、不在文字里截取片段：文件名可以带空格（例如导出的“季度 复盘-v3.pptx”），
 * 按空白切分会把它截断。定位符规则仍由 schemas 校验，带 .. 等歧义段的值不会被换成路径。
 */
export function collectConversationFileLocators(input: {
  readonly toolData: unknown;
  readonly conversationDirectory: string;
}): readonly ConversationFileCandidate[] {
  // 工具报错时没有结果数据，也就没有产物。
  const data = PluginCliToolResultDataSchema.safeParse(input.toolData);
  if (!data.success) return [];
  const report = parseJsonReport(data.data.stdout);
  if (report === undefined) return [];

  const seen = new Set<string>();
  const candidates: ConversationFileCandidate[] = [];
  for (const value of collectStringValues(report)) {
    if (seen.has(value)) continue;
    seen.add(value);
    if (!ConversationFileLocatorSchema.safeParse(value).success) continue;
    const parsed = parseFileLocator(value);
    if (parsed.kind !== 'conversation') continue;
    candidates.push({
      locator: value,
      path: path.join(input.conversationDirectory, ...parsed.relativePath.split('/')),
    });
  }
  return candidates;
}

/** --help 之类的说明文字不是 JSON 报告，其中提到的定位符只是举例，不列为产物。 */
function parseJsonReport(stdout: string): unknown {
  try {
    const report: unknown = JSON.parse(stdout);
    return report;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function* collectStringValues(value: unknown): Generator<string> {
  if (typeof value === 'string') {
    yield value;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) yield* collectStringValues(item);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) yield* collectStringValues(item);
  }
}
