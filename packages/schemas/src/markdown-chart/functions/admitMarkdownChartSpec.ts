/**
 * @file admitMarkdownChartSpec.ts
 * @description 图表规格的唯一准入入口：Agent 写入、粘贴、文件导入、流式事件和 Editor 面板共用。
 *
 * 成功时返回 canonical 规格与文本；失败时返回可修复的诊断。准入是纯函数，
 * 不读取主题或环境，因此同一输入在任何入口得到同一判断。
 */

import type { ZodIssue } from 'zod';
import { MARKDOWN_CHART_LIMITS, MARKDOWN_CHART_TYPES } from '../definitions/markdownChartConstants';
import {
  MARKDOWN_CHART_DIAGNOSTIC_CODES,
  type MarkdownChartDiagnostic,
  type MarkdownChartDiagnosticCode,
  type MarkdownChartPathSegment,
} from '../definitions/markdownChartDiagnostic';
import {
  MARKDOWN_CHART_SERIES_FIELD_NAMES,
  MARKDOWN_CHART_SPEC_FIELD_NAMES,
  MarkdownChartSpecShapeSchema,
  type MarkdownChartSpec,
} from '../definitions/markdownChartSpec';
import { checkMarkdownChartRules } from './checkMarkdownChartRules';
import { formatMarkdownChartPath } from './formatMarkdownChartPath';
import { serializeMarkdownChartSpec } from './serializeMarkdownChartSpec';

export type MarkdownChartAdmissionResult =
  | { readonly ok: true; readonly spec: MarkdownChartSpec; readonly canonicalText: string }
  | { readonly ok: false; readonly diagnostics: readonly MarkdownChartDiagnostic[] };

const MAX_DIAGNOSTICS = 20;

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function diagnostic(
  code: MarkdownChartDiagnosticCode,
  path: readonly MarkdownChartPathSegment[],
  message: string,
): MarkdownChartDiagnostic {
  return { code, path: formatMarkdownChartPath(path), message };
}

function readChartType(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const chartType: unknown = Reflect.get(input, 'chartType');
  return typeof chartType === 'string' ? chartType : null;
}

function isDiagnosticCode(value: unknown): value is MarkdownChartDiagnosticCode {
  return MARKDOWN_CHART_DIAGNOSTIC_CODES.some(code => code === value);
}

function readCustomDiagnosticCode(issue: ZodIssue): MarkdownChartDiagnosticCode | null {
  if (issue.code !== 'custom') return null;
  const code: unknown = issue.params?.['diagnosticCode'];
  return isDiagnosticCode(code) ? code : null;
}

function describeZodIssue(issue: ZodIssue, input: unknown): MarkdownChartDiagnostic[] {
  // Zod 的通用路径包含 symbol；图表的 JSON 诊断只对外输出字符串/数组下标。
  const path = issue.path.map(segment => typeof segment === 'number' ? segment : String(segment));

  if (issue.code === 'invalid_union' && issue.discriminator === 'chartType') {
    return [diagnostic('invalid_chart_type', path,
      `chartType must be one of: ${MARKDOWN_CHART_TYPES.join(', ')}.`)];
  }

  if (issue.code === 'unrecognized_keys') {
    const chartType = readChartType(input);
    const inSeries = path[0] === 'series';
    const known = inSeries ? MARKDOWN_CHART_SERIES_FIELD_NAMES : MARKDOWN_CHART_SPEC_FIELD_NAMES;
    const subject = inSeries
      ? `a ${chartType ?? 'this'} chart series`
      : `chartType "${chartType ?? 'unknown'}"`;
    return issue.keys.map(key => diagnostic('unknown_field', [...path, key], known.has(key)
      ? `field "${key}" does not apply to ${subject}; remove it.`
      : `unknown field "${key}"; remove it.`));
  }

  if (issue.code === 'invalid_value' && path[path.length - 1] === 'version') {
    return [diagnostic('unsupported_version', path, `version must be 1 (or omitted); got ${JSON.stringify(issue.input)}.`)];
  }

  if (issue.code === 'invalid_union') {
    return [diagnostic('invalid_shape', path, 'must be a non-blank single-line text or a finite number.')];
  }

  const custom = readCustomDiagnosticCode(issue);
  if (custom) return [diagnostic(custom, path, issue.message)];

  const required = issue.code === 'invalid_type' && issue.input === undefined;
  return [diagnostic('invalid_shape', path, required ? 'is required.' : issue.message)];
}

function capDiagnostics(diagnostics: MarkdownChartDiagnostic[]): readonly MarkdownChartDiagnostic[] {
  if (diagnostics.length <= MAX_DIAGNOSTICS) return diagnostics;
  const extra = diagnostics.length - MAX_DIAGNOSTICS;
  return [
    ...diagnostics.slice(0, MAX_DIAGNOSTICS),
    diagnostic('invalid_shape', [], `${extra} more issue(s) omitted; fix the ones above first.`),
  ];
}

/** 准入一个已解析的 JSON 值。 */
export function admitMarkdownChartSpec(input: unknown): MarkdownChartAdmissionResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, diagnostics: [diagnostic('not_an_object', [], 'the chart spec must be a JSON object.')] };
  }

  // 仅在本地投影诊断时读取原值，以区分缺失与类型错误；不返回原始 Zod issue。
  const parsed = MarkdownChartSpecShapeSchema.safeParse(input, { reportInput: true });
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: capDiagnostics(parsed.error.issues.flatMap(issue => describeZodIssue(issue, input))),
    };
  }

  const ruleIssues = checkMarkdownChartRules(parsed.data);
  if (ruleIssues.length > 0) {
    return {
      ok: false,
      diagnostics: capDiagnostics(ruleIssues.map(issue => diagnostic(issue.code, issue.path, issue.message))),
    };
  }

  const canonicalText = serializeMarkdownChartSpec(parsed.data);

  // canonical 文本再解析一次：存入文档的对象与重新导入得到的对象由同一路径产生，幂等由构造保证。
  const canonical = MarkdownChartSpecShapeSchema.safeParse(JSON.parse(canonicalText));
  if (!canonical.success) {
    throw new Error(`[MarkdownChart] canonical spec failed re-admission: ${canonical.error.message}`);
  }
  return { ok: true, spec: canonical.data, canonicalText };
}

function locateJsonSyntaxError(body: string, message: string): MarkdownChartDiagnostic['location'] {
  const lineColumn = /line (\d+) column (\d+)/.exec(message);
  if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) };

  const position = /position (\d+)/.exec(message);
  if (!position) return undefined;
  const offset = Math.min(Number(position[1]), body.length);
  const before = body.slice(0, offset).split('\n');
  return { line: before.length, column: (before[before.length - 1]?.length ?? 0) + 1 };
}

/** 准入围栏正文（JSON 文本）。只接受 JSON：不接受 YAML 或 JSON5。 */
export function admitMarkdownChartFenceBody(body: string): MarkdownChartAdmissionResult {
  if (utf8ByteLength(body) > MARKDOWN_CHART_LIMITS.maxFenceBodyBytes) {
    return {
      ok: false,
      diagnostics: [diagnostic('limit_exceeded', [],
        `the fence body exceeds ${MARKDOWN_CHART_LIMITS.maxFenceBodyBytes / 1024} KiB.`)],
    };
  }
  if (body.trim().length === 0) {
    return { ok: false, diagnostics: [diagnostic('invalid_json', [], 'the fence body is empty; it must be one JSON object.')] };
  }

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const location = locateJsonSyntaxError(body, message);
    return {
      ok: false,
      diagnostics: [{
        code: 'invalid_json',
        path: '$',
        message: `the fence body is not valid JSON (${message}). Only strict JSON is accepted: double-quoted keys and strings, no comments, no trailing commas.`,
        ...(location ? { location } : {}),
      }],
    };
  }
  return admitMarkdownChartSpec(value);
}
