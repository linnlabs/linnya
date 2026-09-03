export interface SkillResourceWindowParams {
  /** 1-based 行号；未传时从第 1 行开始。 */
  readonly offset?: number;
  /** 最多读取多少行；未传时读取到末尾。 */
  readonly limit?: number;
}

export interface SkillResourceWindow {
  readonly text: string;
  readonly totalLines: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly isWindowed: boolean;
}

/** Skill 资源以行号续读；该分页单位不能与文件字符 offset 或 Knowledge chunk 混用。 */
export function sliceSkillResourceWindow(
  text: string,
  params: SkillResourceWindowParams,
): SkillResourceWindow {
  if (params.offset !== undefined && params.offset < 0) {
    throw new Error('Skill 资源的 offset 必须是非负整数。');
  }
  if (params.limit !== undefined && params.limit <= 0) {
    throw new Error('Skill 资源的 limit 必须是正整数。');
  }

  const lines = text.split(/\r?\n/);
  const totalLines = lines.length;
  const startLine = Math.max(1, params.offset ?? 1);
  const startIndex = Math.min(startLine - 1, totalLines);
  const endExclusive = params.limit === undefined
    ? totalLines
    : Math.min(totalLines, startIndex + params.limit);
  const selected = lines.slice(startIndex, endExclusive);
  const endLine = selected.length > 0 ? startIndex + selected.length : startLine - 1;

  return {
    text: selected.join('\n'),
    totalLines,
    startLine,
    endLine,
    isWindowed: params.offset !== undefined || params.limit !== undefined,
  };
}
