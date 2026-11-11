import { describe, expect, it } from 'vitest';
import {
  compareSharedImplementations,
  countSharedImplementationHits,
  formatSharedImplementationBaseline,
  parseSharedImplementationBaseline,
} from '../guards/shared-implementations-ratchet';

describe('共享实现棘轮', () => {
  it.each([
    ['apps/renderer/shared/utils/textUnits.ts', 'function countTextUnitsZhEn(text) {}', 'SCHEMAS-text-units'],
    ['src/shared/utils/refIdGenerator.ts', 'function hashToBase62(hash) {}', 'SCHEMAS-block-reference'],
    ['apps/renderer/domains/editor/functions/parse.ts', 'function assertNodeJson(value) {}', 'MARKDOWN-strict-json'],
  ])('阻止 %s 恢复已经迁走的规则', (file, source, ruleId) => {
    expect(countSharedImplementationHits(file, source)).toMatchObject([{ ruleId, count: 1 }]);
  });

  it('合同 declare 和共享 owner 不算第二份运行实现', () => {
    expect(countSharedImplementationHits('packages/plugin-host-contract/renderer/refId.ts', 'export declare function normalizeRef(ref: string): string;')).toEqual([]);
    expect(countSharedImplementationHits('packages/schemas/src/text-units.ts', 'function countTextUnitsZhEn(text) {}')).toEqual([]);
  });
  it('文件大小只能定义在本地化 owner，业务未知值包装可保留', () => {
    const source = 'function formatFileSize(bytes: number) { return String(bytes); }';
    expect(countSharedImplementationHits('apps/renderer/domains/x/presentation.ts', source))
      .toMatchObject([{ ruleId: 'LOCALIZATION-byte-size', count: 1 }]);
    expect(countSharedImplementationHits('apps/renderer/app/localization/functions/formatStorageBytes.ts', source)).toEqual([]);
    expect(countSharedImplementationHits('apps/renderer/domains/x/presentation.ts', 'function formatImageFileSize(bytes) { return bytes < 0 ? "unknown" : formatStorageBytes(bytes, locale); }')).toEqual([]);
  });
  it('共享位置以外的本地定义算命中，共享位置自己不算', () => {
    const source = 'function isRecord(value: unknown): value is Record<string, unknown> {\n  return true;\n}\n';
    expect(countSharedImplementationHits('src/domains/x/readX.ts', source))
      .toEqual([{ ruleId: 'FOUNDATION-is-record', file: 'src/domains/x/readX.ts', count: 1 }]);
    expect(countSharedImplementationHits('packages/foundation/src/isRecord.ts', source)).toEqual([]);
  });

  it('调用共享实现、名字只是前缀相同的都不算', () => {
    const source = [
      "import { isRecord, clamp, sleep } from '@linnya/foundation';",
      'const delay = Math.max(a - b, 0);',
      'function clampColumnWidth(width: number) { return clamp(width, 80, 600); }',
      'if (isRecord(value)) await sleep(10);',
    ].join('\n');
    expect(countSharedImplementationHits('src/domains/x/readX.ts', source)).toEqual([]);
  });

  it('时间显示规则只管界面，且不管本地化自己', () => {
    const source = "const text = new Intl.DateTimeFormat(locale).format(date);\n";
    expect(countSharedImplementationHits('apps/renderer/domains/x/ui/X.vue', source)).toHaveLength(1);
    expect(countSharedImplementationHits('apps/renderer/app/localization/vue/useHistoryTime.ts', source)).toEqual([]);
    expect(countSharedImplementationHits('src/domains/x/formatX.ts', source)).toEqual([]);
  });

  it('只许减少：新增报 expanded，减少报 reduced，基线可往返', () => {
    const baseline = parseSharedImplementationBaseline(formatSharedImplementationBaseline([
      { ruleId: 'FOUNDATION-clamp', file: 'a.ts', count: 2 },
      { ruleId: 'FOUNDATION-sleep', file: 'b.ts', count: 1 },
    ]));
    const diff = compareSharedImplementations([
      { ruleId: 'FOUNDATION-clamp', file: 'a.ts', count: 1 },
      { ruleId: 'FOUNDATION-is-record', file: 'c.ts', count: 1 },
    ], baseline);
    expect(diff.expanded).toEqual([{ ruleId: 'FOUNDATION-is-record', file: 'c.ts', count: 1 }]);
    expect(diff.reduced).toEqual([
      { ruleId: 'FOUNDATION-clamp', file: 'a.ts', count: 1 },
      { ruleId: 'FOUNDATION-sleep', file: 'b.ts', count: 0 },
    ]);
  });
});
