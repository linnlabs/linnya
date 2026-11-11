import type { ProjectFieldCondition, ProjectSavedFilterDefinition } from '@app/schemas';

/**
 * 标签与字段改动对保存的筛选的影响。条件里存的是 ID，改名不受影响；
 * 合并换成目标标签，删除去掉相关条件，改类型去掉这个字段的条件（旧值未必还成立）。
 */
export type SavedFilterRewrite =
  | { readonly kind: 'replace_tag'; readonly from: string; readonly to: string }
  | { readonly kind: 'drop_tag'; readonly tagId: string }
  | { readonly kind: 'drop_field'; readonly fieldId: string }
  /** 改类型：条件都去掉；新类型不是单选时看板不能再按它分列。 */
  | { readonly kind: 'retype_field'; readonly fieldId: string; readonly groupable: boolean }
  | { readonly kind: 'drop_options'; readonly fieldId: string; readonly optionIds: readonly string[] };

function usesOption(condition: ProjectFieldCondition, optionIds: ReadonlySet<string>): boolean {
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];
  return values.some(value => typeof value === 'string' && optionIds.has(value));
}

function tableLayout(definition: ProjectSavedFilterDefinition, fieldId: string): ProjectSavedFilterDefinition['layout'] {
  return definition.layout.group_by === fieldId ? { kind: 'table', group_by: null } : definition.layout;
}

/** 改写后的定义；不受影响时返回 null。 */
export function rewriteSavedFilterDefinition(
  definition: ProjectSavedFilterDefinition,
  rewrite: SavedFilterRewrite,
): ProjectSavedFilterDefinition | null {
  let next: ProjectSavedFilterDefinition;
  switch (rewrite.kind) {
    case 'replace_tag':
      next = { ...definition, tags: [...new Set(definition.tags.map(id => (id === rewrite.from ? rewrite.to : id)))] };
      break;
    case 'drop_tag':
      next = { ...definition, tags: definition.tags.filter(id => id !== rewrite.tagId) };
      break;
    case 'drop_field':
      next = {
        ...definition,
        where: definition.where.filter(condition => condition.field !== rewrite.fieldId),
        layout: tableLayout(definition, rewrite.fieldId),
      };
      break;
    case 'retype_field':
      next = {
        ...definition,
        where: definition.where.filter(condition => condition.field !== rewrite.fieldId),
        layout: rewrite.groupable ? definition.layout : tableLayout(definition, rewrite.fieldId),
      };
      break;
    case 'drop_options': {
      const optionIds = new Set(rewrite.optionIds);
      next = {
        ...definition,
        where: definition.where.filter(condition => condition.field !== rewrite.fieldId || !usesOption(condition, optionIds)),
      };
      break;
    }
  }
  return JSON.stringify(next) === JSON.stringify(definition) ? null : next;
}
