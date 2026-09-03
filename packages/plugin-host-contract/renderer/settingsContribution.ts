import type { Component } from 'vue';

export type SettingsContributionGroup =
  | 'general'
  | 'document-types'
  | 'models'
  | 'about';

export interface SettingsContribution {
  readonly id: string;
  readonly title: string;
  readonly titleMessageKey?: string;
  readonly group: SettingsContributionGroup;
  readonly order: number;
  readonly component: Component;
  readonly isAvailable?: () => boolean;
}

export declare function registerSettingsContribution(contribution: SettingsContribution): void;
export declare function unregisterSettingsContribution(id: string): void;
export declare function listSettingsContributions(): readonly SettingsContribution[];
export declare function clearSettingsContributionsForTest(): void;
