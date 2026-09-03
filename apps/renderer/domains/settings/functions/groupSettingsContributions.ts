// apps/renderer/domains/settings/functions/groupSettingsContributions.ts
// 把扁平的设置贡献列表投影成侧栏导航需要的分段结构。纯函数，不依赖 Vue。

import type {
  SettingsContribution,
  SettingsContributionGroup,
} from '../definitions/settingsContribution';
import {
  SETTINGS_FALLBACK_GROUP,
  SETTINGS_GROUP_ORDER,
  SETTINGS_GROUP_TITLE_KEYS,
} from '../definitions/settingsGroups';
import type { SettingsMessageKey } from '../definitions/settingsMessages';

export interface SettingsNavigationGroup {
  readonly group: SettingsContributionGroup;
  /** null 表示该段不显示标题，只用分隔线与上一段区分。 */
  readonly titleMessageKey: SettingsMessageKey | null;
  readonly items: readonly SettingsContribution[];
}

/**
 * 组间按 SETTINGS_GROUP_ORDER 排，组内按 order 排（order 相同时按标题）。
 * 空分组不会出现在结果里，未知分组落到兜底分组。
 */
export function groupSettingsContributions(
  contributions: readonly SettingsContribution[],
): readonly SettingsNavigationGroup[] {
  const buckets = new Map<SettingsContributionGroup, SettingsContribution[]>();

  for (const contribution of contributions) {
    const group = resolveGroup(contribution.group);
    const bucket = buckets.get(group);
    if (bucket) {
      bucket.push(contribution);
      continue;
    }
    buckets.set(group, [contribution]);
  }

  const groups: SettingsNavigationGroup[] = [];
  for (const group of SETTINGS_GROUP_ORDER) {
    const items = buckets.get(group);
    if (!items || items.length === 0) continue;

    groups.push({
      group,
      titleMessageKey: SETTINGS_GROUP_TITLE_KEYS[group] ?? null,
      items: [...items].sort(compareContributions),
    });
  }

  return groups;
}

/** 导航里从上到下的 tab id 序列，供键盘方向键切换使用。 */
export function flattenSettingsNavigation(
  groups: readonly SettingsNavigationGroup[],
): readonly string[] {
  return groups.flatMap((group) => group.items.map((item) => item.id));
}

function resolveGroup(group: SettingsContributionGroup): SettingsContributionGroup {
  return SETTINGS_GROUP_ORDER.includes(group) ? group : SETTINGS_FALLBACK_GROUP;
}

function compareContributions(a: SettingsContribution, b: SettingsContribution): number {
  return a.order - b.order || a.title.localeCompare(b.title);
}
