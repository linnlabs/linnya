import type { SettingsContribution } from '@linnya/plugin-host-contract/renderer/settingsContribution';

export type {
  SettingsContribution,
  SettingsContributionGroup,
} from '@linnya/plugin-host-contract/renderer/settingsContribution';

const settingsContributions = new Map<string, SettingsContribution>();

export function registerSettingsContribution(contribution: SettingsContribution): void {
  assertNonEmpty(contribution.id, 'id');
  assertNonEmpty(contribution.title, 'title');

  if (settingsContributions.has(contribution.id)) {
    throw new Error(`[settingsContribution] 设置项重复注册: ${contribution.id}`);
  }

  settingsContributions.set(contribution.id, contribution);
}

export function unregisterSettingsContribution(id: string): void {
  settingsContributions.delete(id);
}

export function listSettingsContributions(): readonly SettingsContribution[] {
  return Array.from(settingsContributions.values())
    .filter((contribution) => contribution.isAvailable?.() ?? true)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function clearSettingsContributionsForTest(): void {
  settingsContributions.clear();
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`[settingsContribution] ${field} 不能为空`);
  }
}
