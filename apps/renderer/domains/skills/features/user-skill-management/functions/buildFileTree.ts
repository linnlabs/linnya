export interface SkillFileRow {
  readonly kind: 'file' | 'directory';
  /** 文件为完整相对路径；目录为其路径前缀。 */
  readonly path: string;
  readonly label: string;
  readonly depth: number;
}

/** SKILL.md 永远排第一，其余按目录分组后字母序；目录只作为分组标题，不可点击。 */
export function buildFileTree(files: readonly string[]): readonly SkillFileRow[] {
  const sorted = [...files].sort((a, b) => {
    if (a === 'SKILL.md') return -1;
    if (b === 'SKILL.md') return 1;
    return a.localeCompare(b);
  });
  const rows: SkillFileRow[] = [];
  const opened = new Set<string>();
  for (const file of sorted) {
    const parts = file.split('/');
    for (let depth = 0; depth < parts.length - 1; depth++) {
      const prefix = parts.slice(0, depth + 1).join('/');
      if (opened.has(prefix)) continue;
      opened.add(prefix);
      rows.push({ kind: 'directory', path: prefix, label: parts[depth] ?? prefix, depth });
    }
    rows.push({ kind: 'file', path: file, label: parts[parts.length - 1] ?? file, depth: parts.length - 1 });
  }
  return rows;
}
