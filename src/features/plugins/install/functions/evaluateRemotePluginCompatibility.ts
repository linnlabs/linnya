import { evaluateRendererUiCompatibility } from '@app/schemas';

import { compareDottedVersions } from '../../functions/comparePluginVersions';

export interface RemotePluginCompatibilityRequirement {
  readonly minApp?: string;
  readonly rendererUi?: string;
}

export type RemotePluginCompatibilityResult =
  | { readonly compatible: true }
  | {
      readonly compatible: false;
      readonly reason: 'app-version' | 'renderer-ui';
      readonly detail: string;
    };

/**
 * 商店检查与安装共用同一兼容判断，确保不兼容版本在下载 artifact 前被阻止。
 */
export function evaluateRemotePluginCompatibility(input: {
  readonly appVersion: string;
  readonly rendererUiVersion: string;
  readonly requirement: RemotePluginCompatibilityRequirement;
}): RemotePluginCompatibilityResult {
  if (input.requirement.minApp) {
    const appComparison = compareDottedVersions(input.appVersion, input.requirement.minApp);
    if (appComparison === null) {
      throw new Error(
        `无法比较应用与插件兼容版本: app=${input.appVersion}, minApp=${input.requirement.minApp}`,
      );
    }
    if (appComparison < 0) {
      return {
        compatible: false,
        reason: 'app-version',
        detail: `当前应用版本 ${input.appVersion} 低于插件最低要求 ${input.requirement.minApp}`,
      };
    }
  }

  if (input.requirement.rendererUi) {
    const rendererUiResult = evaluateRendererUiCompatibility(
      input.rendererUiVersion,
      input.requirement.rendererUi,
    );
    if (!rendererUiResult.compatible) {
      if (rendererUiResult.reason === 'invalid-host-version') {
        throw new Error(`当前 Renderer UI 版本无效: ${rendererUiResult.hostVersion}`);
      }
      if (rendererUiResult.reason === 'invalid-range') {
        throw new Error(`插件 Renderer UI 兼容范围无效: ${rendererUiResult.range}`);
      }
      return {
        compatible: false,
        reason: 'renderer-ui',
        detail: `当前 Renderer UI 版本 ${rendererUiResult.hostVersion} 不满足插件要求 ${rendererUiResult.range}`,
      };
    }
  }

  return { compatible: true };
}
