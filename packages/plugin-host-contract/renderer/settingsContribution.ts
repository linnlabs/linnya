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
  /** 页面自带标题与操作区时由页面绘制页头；省略时沿用设置壳的标题。 */
  readonly headerMode?: 'shell' | 'page';
  readonly isAvailable?: () => boolean;
}

export declare function registerSettingsContribution(contribution: SettingsContribution): void;
export declare function unregisterSettingsContribution(id: string): void;
export declare function listSettingsContributions(): readonly SettingsContribution[];
export declare function clearSettingsContributionsForTest(): void;
