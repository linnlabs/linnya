import type { BackendPluginCliContribution } from '@linnya/plugin-host-contract/backend';
import type { PluginId } from '@app/schemas';

import type { BackendPluginCliRegistration } from './registry';

interface ActivePluginCli {
  readonly cli: BackendPluginCliContribution;
  readonly invocations: Set<PluginCliInvocation>;
}

interface PluginCliInvocation {
  readonly abortController: AbortController;
  readonly settlement: Promise<void>;
  readonly resolveSettlement: () => void;
}

export interface BackendPluginCliInvocationLease {
  readonly signal: AbortSignal;
  release(): void;
}

const activePluginClis = new Map<PluginId, ActivePluginCli>();

export function acquireBackendPluginCliInvocation(input: {
  readonly pluginId: PluginId;
  readonly cli: BackendPluginCliContribution;
}): BackendPluginCliInvocationLease | undefined {
  const active = activePluginClis.get(input.pluginId);
  if (!active || active.cli !== input.cli) return undefined;

  let resolveSettlement: () => void = () => {};
  const settlement = new Promise<void>((resolve) => {
    resolveSettlement = resolve;
  });
  const invocation: PluginCliInvocation = {
    abortController: new AbortController(),
    settlement,
    resolveSettlement,
  };
  active.invocations.add(invocation);
  let released = false;
  return Object.freeze({
    signal: invocation.abortController.signal,
    release(): void {
      if (released) return;
      released = true;
      active.invocations.delete(invocation);
      invocation.resolveSettlement();
    },
  });
}

/** 插件资源卸载前先拒绝新 CLI 调用、取消并等待旧 invocation。 */
export async function deactivateStaleBackendPluginClis(
  registrations: readonly BackendPluginCliRegistration[],
): Promise<void> {
  const desired = buildDesiredMap(registrations);
  const settlements: Promise<void>[] = [];
  for (const [pluginId, active] of activePluginClis) {
    if (desired.get(pluginId) === active.cli) continue;
    activePluginClis.delete(pluginId);
    for (const invocation of active.invocations) {
      invocation.abortController.abort(new Error(`Plugin CLI is draining: ${pluginId}`));
      settlements.push(invocation.settlement);
    }
  }
  await Promise.all(settlements);
}

export function activateDesiredBackendPluginClis(
  registrations: readonly BackendPluginCliRegistration[],
): void {
  const desired = buildDesiredMap(registrations);
  for (const [pluginId, cli] of desired) {
    if (!activePluginClis.has(pluginId)) {
      activePluginClis.set(pluginId, { cli, invocations: new Set() });
    }
  }
}

export async function clearBackendPluginClisForTests(): Promise<void> {
  await deactivateStaleBackendPluginClis([]);
}

function buildDesiredMap(
  registrations: readonly BackendPluginCliRegistration[],
): Map<PluginId, BackendPluginCliContribution> {
  const desired = new Map<PluginId, BackendPluginCliContribution>();
  for (const registration of registrations) {
    if (desired.has(registration.pluginId)) {
      throw new Error(`[plugin-registry] Plugin CLI 重复声明: ${registration.pluginId}`);
    }
    desired.set(registration.pluginId, registration.cli);
  }
  return desired;
}
