/**
 * @file documentDiagnostics.ts
 * @description 插件文档写入诊断的通用工具输出渲染。
 *
 * 契约：observation 是 LLM 唯一可见的工具输出；error 级诊断必须自包含在 observation 中。
 * data.diagnostics 是程序化诊断事实，不能假设 LLM 能读取。
 */

import type {
  WorkspaceDocumentFileWriteDiagnostic,
} from '../../../features/workspace/document-file-write/definitions/workspaceDocumentFileWrite';

type DocumentTypeDiagnostic = WorkspaceDocumentFileWriteDiagnostic;

const MAX_VISIBLE_DIAGNOSTICS = 20;
const MAX_MESSAGE_CHARS = 240;
const MAX_TARGET_CHARS = 160;
const MAX_LINES_PER_DIAGNOSTIC_GROUP = 5;

export interface DocumentDiagnosticsToolData {
  readonly diagnostics?: readonly DocumentTypeDiagnostic[];
  readonly diagnosticsTruncatedCount?: number;
}

export interface RenderedDocumentDiagnostics {
  readonly data: DocumentDiagnosticsToolData;
  readonly observationLine?: string;
}

export function renderDocumentDiagnostics(
  diagnostics: readonly DocumentTypeDiagnostic[] | undefined,
): RenderedDocumentDiagnostics {
  const normalized = normalizeDiagnostics(diagnostics);
  if (normalized.length === 0) {
    return { data: {} };
  }

  const { visible, truncatedCount } = selectVisibleDiagnostics(normalized);
  return {
    data: {
      diagnostics: visible,
      ...(truncatedCount > 0 ? { diagnosticsTruncatedCount: truncatedCount } : {}),
    },
    observationLine: formatDiagnosticsObservationLine(visible, truncatedCount),
  };
}

export function appendDocumentDiagnosticsObservation(
  observation: string,
  rendered: RenderedDocumentDiagnostics,
): string {
  return rendered.observationLine ? `${observation}\n${rendered.observationLine}` : observation;
}

function normalizeDiagnostics(
  diagnostics: readonly DocumentTypeDiagnostic[] | undefined,
): readonly DocumentTypeDiagnostic[] {
  return (diagnostics ?? [])
    .map((diagnostic) => {
      const code = diagnostic.code.trim();
      const message = diagnostic.message.trim();
      const target = diagnostic.target?.trim();
      return {
        severity: diagnostic.severity,
        code,
        message: clampText(message, MAX_MESSAGE_CHARS),
        ...(target && target.length > 0 ? { target: clampText(target, MAX_TARGET_CHARS) } : {}),
      };
    })
    .filter((diagnostic) => diagnostic.code.length > 0 && diagnostic.message.length > 0);
}

/**
 * 截断 data.diagnostics 时按严重度优先保留每类诊断至少一条，避免同类问题刷屏。
 */
function selectVisibleDiagnostics(normalized: readonly DocumentTypeDiagnostic[]): {
  readonly visible: readonly DocumentTypeDiagnostic[];
  readonly truncatedCount: number;
} {
  if (normalized.length <= MAX_VISIBLE_DIAGNOSTICS) {
    return { visible: normalized, truncatedCount: 0 };
  }

  const prioritized: DocumentTypeDiagnostic[] = [];
  const seen = new Set<DocumentTypeDiagnostic>();

  const pushUnique = (diagnostic: DocumentTypeDiagnostic): void => {
    if (seen.has(diagnostic) || prioritized.length >= MAX_VISIBLE_DIAGNOSTICS) return;
    seen.add(diagnostic);
    prioritized.push(diagnostic);
  };

  const severityGroups = (['error', 'warning', 'info'] as const)
    .map((severity) => normalized.filter((diagnostic) => diagnostic.severity === severity));
  for (const group of severityGroups) {
    for (const key of uniqueDiagnosticKeys(group)) {
      const first = group.find((diagnostic) => diagnosticKey(diagnostic) === key);
      if (first) pushUnique(first);
    }
    for (const diagnostic of group) {
      pushUnique(diagnostic);
    }
  }

  return {
    visible: prioritized,
    truncatedCount: normalized.length - prioritized.length,
  };
}

function formatDiagnosticsObservationLine(
  diagnostics: readonly DocumentTypeDiagnostic[],
  truncatedCount: number,
): string {
  const counts = countBySeverity(diagnostics);
  const countParts = [
    counts.error > 0 ? `${counts.error} error` : null,
    counts.warning > 0 ? `${counts.warning} warning` : null,
    counts.info > 0 ? `${counts.info} info` : null,
  ].filter((part): part is string => part !== null);
  const truncatedSuffix = truncatedCount > 0 ? `；另 ${truncatedCount} 条未展示` : '';
  const summary = `自检：${countParts.join('、')}${truncatedSuffix}。`;

  const errorDetails = formatErrorDiagnosticDetails(diagnostics);
  const warningDetails = formatWarningDiagnosticDetails(diagnostics);
  const detailLines = [errorDetails, warningDetails].filter((line): line is string => line !== undefined);
  return detailLines.length > 0 ? `${summary}\n${detailLines.join('\n')}` : summary;
}

function formatErrorDiagnosticDetails(diagnostics: readonly DocumentTypeDiagnostic[]): string | undefined {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length === 0) return undefined;

  const groups = groupDiagnosticsByCode(errors);
  const lines: string[] = [];
  for (const { code, message, items } of groups.values()) {
    const lineNumbers = extractLineNumbers(items);
    const location = formatLineNumberList(lineNumbers, items.length);
    lines.push(`- ${formatObservationErrorCode(code)} ×${items.length}${location}：${message}`);
  }

  return lines.length > 0 ? `错误：\n${lines.join('\n')}` : undefined;
}

function formatWarningDiagnosticDetails(diagnostics: readonly DocumentTypeDiagnostic[]): string | undefined {
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
  if (warnings.length === 0) return undefined;

  const groups = groupDiagnosticsByCode(warnings);
  const lines: string[] = [];
  for (const { code, message, items } of groups.values()) {
    const lineNumbers = extractLineNumbers(items);
    const location = formatLineNumberList(lineNumbers, items.length)
      || formatTargetHint(items[0]?.target);
    lines.push(`- ${formatObservationErrorCode(code)} ×${items.length}${location}：${message}`);
  }

  return lines.length > 0 ? `警告：\n${lines.join('\n')}` : undefined;
}

function groupDiagnosticsByCode(
  diagnostics: readonly DocumentTypeDiagnostic[],
): Map<string, {
  readonly code: string;
  readonly message: string;
  readonly items: DocumentTypeDiagnostic[];
}> {
  const groups = new Map<string, {
    readonly code: string;
    readonly message: string;
    readonly items: DocumentTypeDiagnostic[];
  }>();
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic);
    const group = groups.get(key);
    if (group) {
      group.items.push(diagnostic);
      continue;
    }
    groups.set(key, {
      code: diagnostic.code,
      message: diagnostic.message,
      items: [diagnostic],
    });
  }
  return groups;
}

function uniqueDiagnosticKeys(diagnostics: readonly DocumentTypeDiagnostic[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function diagnosticKey(diagnostic: DocumentTypeDiagnostic): string {
  return `${diagnostic.code}\u0000${diagnostic.message}`;
}

function formatObservationErrorCode(code: string): string {
  return code.startsWith('MAP_') ? code.slice(4) : code;
}

function extractLineNumbers(diagnostics: readonly DocumentTypeDiagnostic[]): number[] {
  const lineNumbers: number[] = [];
  const seen = new Set<number>();
  for (const diagnostic of diagnostics) {
    const line = extractLineNumber(diagnostic.target);
    if (line === null || seen.has(line)) continue;
    seen.add(line);
    lineNumbers.push(line);
  }
  return lineNumbers.sort((left, right) => left - right);
}

function extractLineNumber(target: string | undefined): number | null {
  if (!target) return null;
  const match = /^line (\d+)/.exec(target.trim());
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatLineNumberList(lineNumbers: readonly number[], totalCount: number): string {
  if (lineNumbers.length === 0) return '';
  const shown = lineNumbers.slice(0, MAX_LINES_PER_DIAGNOSTIC_GROUP);
  const needsMoreSuffix = totalCount > shown.length;
  const suffix = needsMoreSuffix ? `…共 ${totalCount} 处` : '';
  return `（line ${shown.join(',')}${suffix}）`;
}

function formatTargetHint(target: string | undefined): string {
  return target ? `（${target}）` : '';
}

function countBySeverity(diagnostics: readonly DocumentTypeDiagnostic[]): {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
} {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of diagnostics) {
    counts[diagnostic.severity] += 1;
  }
  return counts;
}

function clampText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
}
