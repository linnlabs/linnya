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

/** 外观页内一节；组件只负责该节内容，页壳与分节标题由 Settings owner 绘制。 */
export interface AppearanceSectionContribution {
  readonly pluginId: string;
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly component: Component;
  readonly isAvailable?: () => boolean;
}

export declare function registerAppearanceSection(contribution: AppearanceSectionContribution): void;
export declare function unregisterAppearanceSection(pluginId: string, id: string): void;
export declare function listAppearanceSections(): readonly AppearanceSectionContribution[];
export declare function clearAppearanceSectionsForTest(): void;
