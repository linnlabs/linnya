import { describe, expect, it } from 'vitest';

import {
  analyzeEmptyCatchSource,
  runNoEmptyCatchGuard,
} from '../guards/no-empty-catch-guard';

describe('no-empty-catch guard', () => {
  it('当前生产代码和构建脚本不存在空 catch', () => {
    expect(runNoEmptyCatchGuard()).toEqual([]);
  });

  it.each([
    ['无参数 catch', 'try { work(); } catch {}'],
    ['带参数 catch', 'try { work(); } catch (error) {}'],
  ])('捕获%s', (_name, source) => {
    expect(analyzeEmptyCatchSource('src/example.ts', source)).toHaveLength(1);
  });

  it('允许显式记录、转换、返回或重新抛出', () => {
    const source = [
      'try { a(); } catch (error) { logger.warn(String(error)); }',
      'try { b(); } catch (error) { throw normalize(error); }',
      'try { c(); } catch { return null; }',
    ].join('\n');
    expect(analyzeEmptyCatchSource('src/example.ts', source)).toEqual([]);
  });

  it('第一阶段保留带明确说明的历史 catch，避免用批量日志补丁改动稳定链路', () => {
    expect(analyzeEmptyCatchSource(
      'src/example.ts',
      'try { releasePointerCapture(); } catch { /* pointer capture 已释放 */ }',
    )).toEqual([]);
  });

  it('解析 Vue script 并报告 SFC 真实行号', () => {
    const source = [
      '<template><div /></template>',
      '<script setup lang="ts">',
      'try { work(); } catch {}',
      '</script>',
    ].join('\n');
    expect(analyzeEmptyCatchSource('apps/renderer/Example.vue', source)).toEqual([
      expect.objectContaining({ line: 3 }),
    ]);
  });
});
