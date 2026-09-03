import { afterEach, describe, expect, it } from 'vitest';
import type { BackendPluginCliContribution } from '@linnya/plugin-host-contract/backend';

import type { BackendPluginCliRegistration } from '../registry';
import {
  acquireBackendPluginCliInvocation,
  activateDesiredBackendPluginClis,
  clearBackendPluginClisForTests,
  deactivateStaleBackendPluginClis,
} from '../pluginCliInvocationRuntime';

const cli: BackendPluginCliContribution = {
  prepare: () => ({
    status: 'completed',
    result: { exitCode: 0, stdout: '', stderr: '' },
  }),
};
const registration: BackendPluginCliRegistration = {
  pluginId: 'cli-fixture-a',
  cli,
};

afterEach(async () => {
  await clearBackendPluginClisForTests();
});

describe('plugin CLI invocation runtime', () => {
  it('插件卸载先拒绝新调用，再取消并等待现有 invocation 释放', async () => {
    activateDesiredBackendPluginClis([registration]);
    const lease = acquireBackendPluginCliInvocation(registration);
    if (!lease) throw new Error('plugin CLI invocation was not acquired');

    let drainingSettled = false;
    const draining = deactivateStaleBackendPluginClis([]).then(() => {
      drainingSettled = true;
    });
    await Promise.resolve();

    expect(lease.signal.aborted).toBe(true);
    expect(acquireBackendPluginCliInvocation(registration)).toBeUndefined();
    expect(drainingSettled).toBe(false);

    lease.release();
    await draining;
    expect(drainingSettled).toBe(true);
  });

  it('多个 stale 插件先同时停止接单并收到 abort，再等待各自 settlement', async () => {
    const secondRegistration: BackendPluginCliRegistration = {
      pluginId: 'cli-fixture-b',
      cli: {
        prepare: () => ({
          status: 'completed',
          result: { exitCode: 0, stdout: '', stderr: '' },
        }),
      },
    };
    activateDesiredBackendPluginClis([registration, secondRegistration]);
    const firstLease = acquireBackendPluginCliInvocation(registration);
    const secondLease = acquireBackendPluginCliInvocation(secondRegistration);
    if (!firstLease || !secondLease) throw new Error('plugin CLI invocation was not acquired');

    const draining = deactivateStaleBackendPluginClis([]);
    await Promise.resolve();
    expect(firstLease.signal.aborted).toBe(true);
    expect(secondLease.signal.aborted).toBe(true);
    expect(acquireBackendPluginCliInvocation(registration)).toBeUndefined();
    expect(acquireBackendPluginCliInvocation(secondRegistration)).toBeUndefined();

    firstLease.release();
    await Promise.resolve();
    secondLease.release();
    await draining;
  });
});
