import type { ProjectOverviewField } from '@app/schemas';
import type { ProjectOverviewRow } from '../definitions/projectOverview';

export interface ProjectOverviewBoardLane {
  /** 选项 ID；没填的一列为 null。 */
  readonly key: string | null;
  readonly name: string;
  readonly rows: readonly ProjectOverviewRow[];
}

/** 看板只能按单选字段分列：拖到哪一列就是把值改成哪个选项，一份文档只在一列里。 */
export function isBoardGroupField(field: ProjectOverviewField): boolean {
  return field.value_type === 'select' && !field.readonly;
}

/**
 * 按单选字段分列，列序同选项顺序，没填的单独一列放最后。标签不带这个字段的文档不在看板里
 * （拖进去也写不了），计入 `excluded`。值指向已删除的选项时算没填。行内顺序沿用传入的排序。
 */
export function groupProjectOverviewBoard(
  rows: readonly ProjectOverviewRow[],
  field: ProjectOverviewField,
  unsetName: string,
  overrides: ReadonlyMap<string, string | null> = new Map(),
): { readonly lanes: readonly ProjectOverviewBoardLane[]; readonly excluded: number } {
  const byOption = new Map<string | null, ProjectOverviewRow[]>([
    ...field.options.map(option => [option.id, []] as [string, ProjectOverviewRow[]]),
    [null, []],
  ]);
  let excluded = 0;
  for (const row of rows) {
    if (!row.fieldIds.includes(field.id)) {
      excluded += 1;
      continue;
    }
    const raw = overrides.has(row.documentId) ? overrides.get(row.documentId) : row.fieldValues[field.id];
    const key = typeof raw === 'string' && byOption.has(raw) ? raw : null;
    byOption.get(key)?.push(row);
  }
  return {
    lanes: [
      ...field.options.map(option => ({ key: option.id, name: option.name, rows: byOption.get(option.id) ?? [] })),
      { key: null, name: unsetName, rows: byOption.get(null) ?? [] },
    ],
    excluded,
  };
}

/** 卡片上的其他字段，如“作者 Chen · 2025”：最多两项，跳过分列字段、网址和未勾选。 */
export function boardCardFieldsText(
  row: ProjectOverviewRow,
  fields: readonly ProjectOverviewField[],
  groupBy: string,
  limit = 2,
): string {
  const parts: string[] = [];
  for (const id of row.fieldIds) {
    if (parts.length >= limit) break;
    if (id === groupBy) continue;
    const field = fields.find(candidate => candidate.id === id);
    const value = row.fieldValues[id];
    if (!field || value === undefined || value === null || field.value_type === 'url') continue;
    const option = (optionId: unknown) => field.options.find(candidate => candidate.id === optionId)?.name ?? String(optionId);
    if (field.value_type === 'checkbox') {
      if (value === true) parts.push(field.name);
      continue;
    }
    if (field.value_type === 'select') parts.push(`${field.name} ${option(value)}`);
    else if (Array.isArray(value)) parts.push(`${field.name} ${value.map(option).join('、')}`);
    else parts.push(`${field.name} ${String(value)}`);
  }
  return parts.join(' · ');
}
