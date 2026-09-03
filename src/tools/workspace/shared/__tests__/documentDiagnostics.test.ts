import { describe, expect, it } from 'vitest';

import {
  appendDocumentDiagnosticsObservation,
  renderDocumentDiagnostics,
} from '../documentDiagnostics';
import type { DocumentTypeDiagnostic } from '@plugin/backend/documentTypeBackendHook';

describe('documentDiagnostics', () => {
  it('无诊断时不增加 observation 噪声', () => {
    const rendered = renderDocumentDiagnostics([]);

    expect(rendered.data).toEqual({});
    expect(rendered.observationLine).toBeUndefined();
    expect(appendDocumentDiagnosticsObservation('已写入。', rendered)).toBe('已写入。');
  });

  it('warning 按 code 分组写入中性 observation', () => {
    const rendered = renderDocumentDiagnostics([
      { severity: 'warning', code: 'MAP_DUPLICATE_EDGE', message: '发现重复关系', target: 'edge[1]' },
      { severity: 'info', code: 'MAP_SUGGESTED_NODE', message: '建议复核节点' },
    ]);

    expect(rendered.observationLine).toBe([
      '自检：1 warning、1 info。',
      '警告：',
      '- DUPLICATE_EDGE ×1（edge[1]）：发现重复关系',
    ].join('\n'));
    expect(rendered.data.diagnostics).toHaveLength(2);
  });

  it('error 按 code 分组写入 observation，并去掉 MAP_ 前缀便于对照 DSL 文档', () => {
    const rendered = renderDocumentDiagnostics([
      {
        severity: 'error',
        code: 'MAP_SYNTAX_ERROR',
        message: 'Comments must use "//"; "#" is not valid .smap comment syntax.',
        target: 'line 5, column 1',
      },
      {
        severity: 'error',
        code: 'MAP_SYNTAX_ERROR',
        message: 'Comments must use "//"; "#" is not valid .smap comment syntax.',
        target: 'line 6, column 1',
      },
      {
        severity: 'error',
        code: 'MAP_INVALID_VALIDITY',
        message: 'Unsupported edge validity: stale. Allowed values: current, historical, deprecated, planned',
        target: 'line 308, column 1',
      },
    ]);

    expect(rendered.observationLine).toBe([
      '自检：3 error。',
      '错误：',
      '- SYNTAX_ERROR ×2（line 5,6）：Comments must use "//"; "#" is not valid .smap comment syntax.',
      '- INVALID_VALIDITY ×1（line 308）：Unsupported edge validity: stale. Allowed values: current, historical, deprecated, planned',
    ].join('\n'));
    expect(appendDocumentDiagnosticsObservation('已保存 draft。', rendered)).toContain('SYNTAX_ERROR ×2');
  });

  it('warning 与 error 一样聚合源码行号', () => {
    const rendered = renderDocumentDiagnostics([
      {
        severity: 'warning',
        code: 'LAYOUT_UNATTACHED_CONTENT_SUBTREE',
        message: '容器未接入最终 Slide 树。',
        target: 'line 209, slide 4',
      },
      {
        severity: 'warning',
        code: 'LAYOUT_UNATTACHED_CONTENT_SUBTREE',
        message: '容器未接入最终 Slide 树。',
        target: 'line 257, slide 5',
      },
    ]);

    expect(rendered.observationLine).toContain(
      'LAYOUT_UNATTACHED_CONTENT_SUBTREE ×2（line 209,257）：容器未接入最终 Slide 树。',
    );
  });

  it('截断后只用可见 error 生成行号与计数', () => {
    const syntaxErrors: DocumentTypeDiagnostic[] = Array.from({ length: 30 }, (_, index) => ({
      severity: 'error',
      code: 'MAP_SYNTAX_ERROR',
      message: 'Comments must use "//"; "#" is not valid .smap comment syntax.',
      target: `line ${index + 5}, column 1`,
    }));
    const rendered = renderDocumentDiagnostics([
      ...syntaxErrors,
      {
        severity: 'error',
        code: 'MAP_INVALID_VALIDITY',
        message: 'Unsupported edge validity: stale. Allowed values: current, historical, deprecated, planned',
        target: 'line 384, column 1',
      },
    ]);

    expect(rendered.observationLine).toContain('自检：20 error；另 11 条未展示。');
    expect(rendered.observationLine).toContain('SYNTAX_ERROR ×19（line 5,6,7,8,9…共 19 处）');
    expect(rendered.observationLine).toContain('INVALID_VALIDITY ×1（line 384）');
  });

  it('同一 code 的不同消息分别展示，避免丢失可行动信息', () => {
    const rendered = renderDocumentDiagnostics([
      {
        severity: 'error',
        code: 'MAP_SYNTAX_ERROR',
        message: 'Unexpected closing block brace.',
        target: 'line 3, column 1',
      },
      {
        severity: 'error',
        code: 'MAP_SYNTAX_ERROR',
        message: 'Block header is missing.',
        target: 'line 8, column 1',
      },
    ]);

    expect(rendered.observationLine).toContain('SYNTAX_ERROR ×1（line 3）：Unexpected closing block brace.');
    expect(rendered.observationLine).toContain('SYNTAX_ERROR ×1（line 8）：Block header is missing.');
  });

  it('截断 data.diagnostics 时优先保留每类 error 至少一条', () => {
    const diagnostics: DocumentTypeDiagnostic[] = [
      ...Array.from({ length: 19 }, (_, index) => ({
        severity: 'error' as const,
        code: 'MAP_SYNTAX_ERROR',
        message: `syntax ${index}`,
        target: `line ${index + 1}, column 1`,
      })),
      {
        severity: 'error',
        code: 'MAP_INVALID_VALIDITY',
        message: 'Unsupported edge validity: stale. Allowed values: current, historical, deprecated, planned',
        target: 'line 99, column 1',
      },
      {
        severity: 'warning',
        code: 'MAP_DUPLICATE_EDGE',
        message: 'duplicate',
      },
    ];

    const rendered = renderDocumentDiagnostics(diagnostics);

    expect(rendered.data.diagnostics).toHaveLength(20);
    expect(rendered.data.diagnosticsTruncatedCount).toBe(1);
    expect(rendered.data.diagnostics?.some((item) => item.code === 'MAP_INVALID_VALIDITY')).toBe(true);
    expect(rendered.observationLine).toContain('自检：20 error；另 1 条未展示。');
    expect(rendered.observationLine).not.toContain('duplicate');
    expect(rendered.observationLine).not.toContain('data');
  });

  it('压缩超长 message', () => {
    const diagnostics: DocumentTypeDiagnostic[] = [{
      severity: 'error',
      code: 'MAP_PARSE_ERROR',
      message: 'x'.repeat(260),
    }];

    const rendered = renderDocumentDiagnostics(diagnostics);

    expect(rendered.data.diagnostics?.[0]?.message).toHaveLength(240);
  });
});
