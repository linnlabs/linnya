/**
 * @file src/agent/runtime-kernel/llm/toolCallUtils.ts
 *
 * @description
 * Tool-call 相关的纯函数工具：
 * - 解析/拆分“拼接的 JSON 对象”字符串（例如 "{}{}"）
 * - 安全地把 JSON 字符串解析为 Record（不使用 any）
 *
 * 背景：
 * 部分模型在流式工具调用中可能会把多个 JSON 对象片段连续输出；
 * 如果直接拼接，会得到 `}{` 导致 arguments 不是合法 JSON，从而：
 * - 本地 JSON.parse 失败，工具拿到空参数
 * - 更严重：非法 tool_calls 被写入 history 并在下一轮回放，触发上游 400/500 校验错误
 */

type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function tryParseJsonRecord(input: string): { ok: true; value: UnknownRecord } | { ok: false } {
  try {
    const parsed: unknown = JSON.parse(input);
    if (!isRecord(parsed)) {
      return { ok: false };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false };
  }
}

/**
 * 把形如 "{}{}" / "{...}\n{...}" 的字符串按“顶层 JSON 对象”拆分为多个 JSON 字符串。
 *
 * 约束：
 * - 仅拆分顶层对象（以 '{' 开始、以配对 '}' 结束）
 * - 需要正确处理字符串字面量与转义，避免把字符串中的 '{' '}' 当作结构字符
 */
export function splitConcatenatedJsonObjects(input: string): string[] {
  const s = input.trim();
  if (!s) return [];

  const results: string[] = [];

  let inString = false;
  let escape = false;
  let depth = 0;
  let startIndex: number | null = null;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (ch === '\\\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) {
        startIndex = i;
      }
      depth += 1;
      continue;
    }

    if (ch === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && startIndex !== null) {
          const piece = s.slice(startIndex, i + 1).trim();
          if (piece) results.push(piece);
          startIndex = null;
        }
      }
      continue;
    }
  }

  return results;
}
