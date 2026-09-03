/** ask 协议错误的模型可读格式化。 */
import { z, type ZodIssue } from 'zod';

function formatIssuePath(path: readonly (string | number)[]): string {
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') return `${formatted}[${segment}]`;
    return formatted.length === 0 ? segment : `${formatted}.${segment}`;
  }, '');
}

/** 给模型返回可直接定位并修正的 ask 参数路径。 */
export function formatAskToolInputIssues(issues: readonly ZodIssue[]): string {
  return issues.flatMap((issue) => {
    if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      return issue.keys.map((key) => {
        const path = formatIssuePath([...issue.path, key]);
        return `${path}: field is not allowed for this question type`;
      });
    }

    const path = formatIssuePath(issue.path);
    return `${path || 'input'}: ${issue.message}`;
  }).join('; ');
}
