import { check, resolveConfig } from 'prettier';
import type { CanvasQualityIssue, CanvasQualitySource } from '../definitions/canvasQuality';

/** 先固定仓内排版，再按真实物理行计量；不能用压行绕过函数/文件长度门禁。 */
export async function checkCanvasSourceFormatting(
  sources: readonly CanvasQualitySource[]
): Promise<readonly CanvasQualityIssue[]> {
  const files = new Map(sources.map(source => [source.path, source]));
  const results = await Promise.all(
    [...files.values()].map(async source => {
      const config = await resolveConfig(source.path);
      const formatted = await check(source.text, { ...config, filepath: source.path });
      if (formatted) return [];
      return [
        {
          rule: 'format',
          severity: 'error',
          file: source.relative,
          line: 1,
          message: '源文件须符合仓内Prettier配置，禁止压行规避长度门禁。',
        },
      ] satisfies CanvasQualityIssue[];
    })
  );
  return results.flat();
}
