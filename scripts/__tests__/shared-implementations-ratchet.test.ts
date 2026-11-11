import { describe, expect, it } from 'vitest';
import {
  compareSharedImplementations,
  countSharedImplementationHits,
  formatSharedImplementationBaseline,
  parseSharedImplementationBaseline,
} from '../guards/shared-implementations-ratchet';

describe('共享实现棘轮', () => {
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
