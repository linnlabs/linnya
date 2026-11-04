import { createHash } from 'node:crypto';
import type { CanvasTraceInvocation } from '../definitions/canvasToolTrace';
const argument = `(?:"([^"$\\x60]*)"|'([^']*)'|([^\\s"']+))`;
function literalOption(line: string, option: string): string | null {
  const match = new RegExp(`(?:^|\\s)${option}\\s+${argument}(?=\\s|$)`).exec(line);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}
function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function readInvocation(
  line: string,
  files: ReadonlyMap<string, string>,
  cwd: string
): CanvasTraceInvocation | null {
  // 这里只认直接字面命令；变量、控制流或管道必须人工复核，不实现第二套shell解释器。
  if (/[`$;&|<>]/.test(line)) return null;
  const match = new RegExp(
    `^\\s*linnya-canvas\\s+(apply|arrange|check|render)\\s+${argument}(?=\\s|$)`
  ).exec(line);
  if (!match) return null;
  const kind = match[1],
    target = match[2] ?? match[3] ?? match[4];
  if (!target || (kind !== 'apply' && kind !== 'arrange' && kind !== 'check' && kind !== 'render'))
    return null;
  const file = literalOption(line, '--ops-file'),
    inputKey = file ? `${cwd}:${file}` : kind === 'arrange' ? `${cwd}:arrange:${target}` : null;
  const payload =
    kind === 'arrange'
      ? line
          .replace(/--request-id\s+(?:"[^"]*"|'[^']*'|\S+)/, '')
          .replace('--dry-run', '')
          .trim()
      : inputKey
        ? files.get(inputKey)
        : undefined;
  return {
    kind,
    target,
    requestId: literalOption(line, '--request-id'),
    dryRun: /(?:^|\s)--dry-run(?:\s|$)/.test(line),
    inputKey,
    fingerprint: payload === undefined ? null : fingerprint(payload),
  };
}
/** 去除here-doc正文，只有带引号的cat字面输入可作为载荷变化证据。 */
export function readLiteralCanvasCommands(
  command: string,
  files: Map<string, string>,
  cwd: string
) {
  const invocations: CanvasTraceInvocation[] = [];
  const receiptInvocations: CanvasTraceInvocation[] = [];
  let delimiter: string | null = null,
    file: string | null = null,
    body: string[] = [],
    ambiguous = false,
    controlFlow = false;
  for (const line of command.split('\n')) {
    if (delimiter !== null) {
      if (line.trim() === delimiter) {
        if (file) files.set(`${cwd}:${file}`, body.join('\n'));
        delimiter = null;
        file = null;
        body = [];
      } else body.push(line);
      continue;
    }
    const here = /<<\s*(['"])([a-zA-Z_][\w-]*)\1\s*$/.exec(line);
    if (here) {
      delimiter = here[2];
      file = /^\s*cat\s+>\s*(\S+)\s+<</.exec(line)?.[1] ?? null;
      if (!file) {
        files.clear();
        ambiguous = true;
      }
      continue;
    }
    if (/^\s*(?:(?:if|then|elif|else|fi|for|while|until|select|do|done|case|esac|function)\b|[\w-]+\s*\(\)|[{}()])/.test(line)) {
      ambiguous = true;
      controlFlow = true;
    }
    const invocation = readInvocation(line, files, cwd);
    // 管道后的摘要不能证明结果，但管道前完整字面命令可以证明该run请求过这个编号。
    // 不解释控制流、不读here-doc正文、不接纳变量或重定向前缀。
    const receipt =
      invocation ??
      (line.includes('|')
        ? readInvocation(line.slice(0, line.indexOf('|')).trim(), files, cwd)
        : null);
    if (
      receipt &&
      !receipt.dryRun &&
      receipt.requestId &&
      (receipt.kind === 'apply' || receipt.kind === 'arrange')
    )
      receiptInvocations.push(receipt);
    if (invocation) invocations.push(invocation);
    else {
      if (line.trim() && !line.trim().startsWith('#')) {
        files.clear();
        ambiguous = true;
      }
    }
  }
  return {
    invocations,
    receiptInvocations: controlFlow || delimiter !== null ? [] : receiptInvocations,
    ambiguous: ambiguous || delimiter !== null,
  };
}
