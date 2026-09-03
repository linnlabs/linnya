import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createAiSdkThirdPartyNotice,
  readAiSdkReleasePackages,
  validateAiSdkThirdPartyNotice,
} from './aiSdkThirdPartyNotice';

const rootDir = path.resolve(import.meta.dirname, '..', '..', '..');

describe('AI SDK third-party release notice', () => {
  it('覆盖全部正式直接依赖，并与安装包发布声明保持一致', () => {
    const notice = createAiSdkThirdPartyNotice(rootDir);

    for (const packageInfo of readAiSdkReleasePackages(rootDir)) {
      expect(notice).toContain(`- ${packageInfo.name}@${packageInfo.version}`);
    }
    expect(notice).toContain('models.dev catalog data');
    expect(notice).toContain('Copyright (c) 2025 models.dev');
    expect(notice).toContain('Craft Agents OAuth derived source');
    expect(notice).toContain('Copyright 2026 Craft Docs Ltd.');
    expect(notice).toContain('Source: https://github.com/OpenRouterTeam/ai-sdk-provider');
    expect(validateAiSdkThirdPartyNotice(rootDir)).toEqual([]);
  });
});
