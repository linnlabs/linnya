import type { AssembleWebSourcesArgs } from '@app/schemas';

/** 注释是有界展示信息，超长不应让已取得的来源整包失败；裁剪必须显式告知父 Agent。 */
export function boundWebSourceNotes(input: AssembleWebSourcesArgs): {
  selection: AssembleWebSourcesArgs;
  truncated: boolean;
} {
  let truncated = false;
  const shorten = (value: string, limit: number): string => {
    if (value.length <= limit) return value;
    truncated = true;
    return value.slice(0, limit - 1) + '…';
  };
  return {
    selection: {
      selected: input.selected.map(source => ({
        ...source,
        purpose: shorten(source.purpose, 300),
      })),
      summary: shorten(input.summary, 1200),
      gaps: input.gaps.map(gap => shorten(gap, 500)),
      conflicts: input.conflicts.map(conflict => shorten(conflict, 500)),
    },
    truncated,
  };
}
