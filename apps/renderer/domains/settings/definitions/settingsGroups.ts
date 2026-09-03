// apps/renderer/domains/settings/definitions/settingsGroups.ts
// 设置导航的分组顺序与文案。分组 key 与 @plugin/renderer/settingsContribution 的契约一致：
// 贡献方（核心域或插件）只声明自己属于哪个 group，导航壳负责决定它出现在第几段、段标题叫什么。

import type { SettingsContributionGroup } from './settingsContribution';
import type { SettingsMessageKey } from './settingsMessages';

/** 侧栏从上到下的分组顺序。不在这里出现的分组不会被渲染。 */
export const SETTINGS_GROUP_ORDER: readonly SettingsContributionGroup[] = [
  'general',
  'models',
  'document-types',
  'about',
];

/**
 * 分组标题文案 key。值为 null 表示这一段不显示标题，
 * 只用一条分隔线与上一段区分（例如「关于」只有一个条目，再加标题只会重复）。
 */
export const SETTINGS_GROUP_TITLE_KEYS: Readonly<
  Record<SettingsContributionGroup, SettingsMessageKey | null>
> = {
  general: 'settings.groups.general',
  models: 'settings.groups.models',
  'document-types': 'settings.groups.documentTypes',
  about: null,
};

/**
 * 插件传入契约外的 group 时的兜底分组。
 * 宁可放错一段，也不能让条目从导航里消失。
 */
export const SETTINGS_FALLBACK_GROUP: SettingsContributionGroup = 'document-types';
