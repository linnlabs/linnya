import { expect, test } from 'vitest';
import { countTextUnitsZhEn, sliceTextByUnitsZhEn } from '../src';
import { TEXT_UNIT_CASES } from './fixtures/textUnitCases';

test('后端合同入口保持固定计量与截短结果', () => {
  for (const sample of TEXT_UNIT_CASES) {
    expect(countTextUnitsZhEn(sample.text)).toBe(sample.count);
    expect(sliceTextByUnitsZhEn(sample.text, sample.limit)).toBe(sample.slice);
  }
});
