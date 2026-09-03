import { afterEach, describe, expect, it } from 'vitest';

import { createWorkspaceMutationPublisher } from 'src/features/workspace/orchestration/workspaceMutationPublisherRegistry';
import { isPluginRuntimeEnabled } from './pluginRuntime';
import {
  installPluginHostTestRuntime,
  resetPluginHostTestRuntime,
} from './testRuntime';

describe('plugin backend test runtime', () => {
  afterEach(() => {
    resetPluginHostTestRuntime();
  });

  it('installs and resets the public plugin test composition boundary', () => {
    installPluginHostTestRuntime({
      installedPluginIds: ['platform', 'fixture-plugin'],
      enabledPluginIds: ['platform', 'fixture-plugin'],
    });

    expect(isPluginRuntimeEnabled('fixture-plugin')).toBe(true);
    expect(() => createWorkspaceMutationPublisher()).not.toThrow();

    resetPluginHostTestRuntime();

    expect(() => createWorkspaceMutationPublisher()).toThrow(
      'Workspace mutation publisher 尚未由 App composition 安装',
    );
  });
});
