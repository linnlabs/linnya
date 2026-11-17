import { withActionActor } from 'src/domains/action-ledger';
import type { PluginId } from '@app/schemas';
import { pluginDiagnostics } from './diagnostics';
import type { BackendPluginRuntimeEffectRegistration } from './registry';

interface ActiveRuntimeEffect {
  readonly pluginId: PluginId;
  readonly effectId: string;
  readonly effect: BackendPluginRuntimeEffectRegistration['effect'];
  readonly deactivate: () => void | Promise<void>;
  deactivationFailed?: boolean;
}

const activeEffects = new Map<string, ActiveRuntimeEffect>();

export function assertBackendPluginCanDeactivate(pluginId: string): void {
  for (const active of activeEffects.values())
    if (active.pluginId === pluginId) active.effect.assertCanDeactivate?.();
}

export function hasActiveBackendPluginWork(): boolean {
  return [...activeEffects.values()].some(active => active.effect.hasActiveWork?.() === true);
}

/** App 正常退出已经停止 ingress；不再要求用户等待插件工具结束，直接交 owner 取消收尾。 */
export async function stopBackendPluginRuntimeEffects(): Promise<void> {
  await deactivateStaleRuntimeEffects(new Map());
}

export async function syncBackendPluginRuntimeEffects(
  registrations: readonly BackendPluginRuntimeEffectRegistration[]
): Promise<void> {
  const desired = buildDesiredEffectMap(registrations);
  await deactivateStaleRuntimeEffects(desired);
  await activateDesiredRuntimeEffects(desired);
}

export async function deactivateStaleBackendPluginRuntimeEffects(
  registrations: readonly BackendPluginRuntimeEffectRegistration[]
): Promise<void> {
  const desired = buildDesiredEffectMap(registrations);
  await deactivateStaleRuntimeEffects(desired);
}

export async function activateDesiredBackendPluginRuntimeEffects(
  registrations: readonly BackendPluginRuntimeEffectRegistration[]
): Promise<void> {
  const desired = buildDesiredEffectMap(registrations);
  await activateDesiredRuntimeEffects(desired);
}

async function deactivateStaleRuntimeEffects(
  desired: ReadonlyMap<string, BackendPluginRuntimeEffectRegistration>
): Promise<void> {
  for (const [effectKey, active] of activeEffects) {
    // 同 ID 的新版 artifact 仍是新的 contribution 实例；先等待旧资源完全停止，
    // 才能激活新实例。仅按 ID 判等会把旧 Worker/闭包永久留到下一次重启。
    if (active.deactivationFailed || desired.get(effectKey)?.effect !== active.effect) {
      // 半停实例不能在重新启用时复用；失败仍保留 owner，下一次同步先完成旧清理。
      active.deactivationFailed = true;
      await runEffectStep(active.pluginId, active.effectId, 'deactivate', active.deactivate);
      activeEffects.delete(effectKey);
    }
  }
}

async function activateDesiredRuntimeEffects(
  desired: ReadonlyMap<string, BackendPluginRuntimeEffectRegistration>
): Promise<void> {
  for (const [effectKey, registration] of desired) {
    if (activeEffects.has(effectKey)) {
      continue;
    }
    await runEffectStep(
      registration.pluginId,
      registration.effect.id,
      'activate',
      registration.effect.activate
    );
    activeEffects.set(effectKey, {
      pluginId: registration.pluginId,
      effectId: registration.effect.id,
      effect: registration.effect,
      deactivate: registration.effect.deactivate,
    });
  }
}

export async function clearSyncedBackendPluginRuntimeEffectsForTests(): Promise<void> {
  for (const [effectKey, active] of activeEffects) {
    await runEffectStep(active.pluginId, active.effectId, 'deactivate', active.deactivate);
    activeEffects.delete(effectKey);
  }
}

function buildDesiredEffectMap(
  registrations: readonly BackendPluginRuntimeEffectRegistration[]
): Map<string, BackendPluginRuntimeEffectRegistration> {
  const desired = new Map<string, BackendPluginRuntimeEffectRegistration>();
  for (const registration of registrations) {
    const effectId = normalizeEffectId(registration.effect.id, registration.pluginId);
    const effectKey = buildEffectKey(registration.pluginId, effectId);
    if (desired.has(effectKey)) {
      const message = `runtime effect 重复声明: ${effectKey}`;
      recordRuntimeEffectError(registration.pluginId, effectId, message);
      throw new Error(`[plugin-registry] ${message}`);
    }
    desired.set(effectKey, registration);
  }
  return desired;
}

async function runEffectStep(
  pluginId: PluginId,
  effectId: string,
  step: 'activate' | 'deactivate',
  fn: () => void | Promise<void>
): Promise<void> {
  try {
    await withActionActor({ kind: 'plugin', pluginId }, fn);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordRuntimeEffectError(pluginId, effectId, `runtime effect ${step} failed: ${message}`);
    throw error;
  }
}

function normalizeEffectId(effectId: string, pluginId: PluginId): string {
  const normalized = effectId.trim();
  if (normalized.length > 0) {
    return normalized;
  }

  const message = `插件声明了空 runtime effect id: ${pluginId}`;
  recordRuntimeEffectError(pluginId, '', message);
  throw new Error(`[plugin-registry] ${message}`);
}

function buildEffectKey(pluginId: PluginId, effectId: string): string {
  return `${pluginId}:${effectId}`;
}

function recordRuntimeEffectError(pluginId: PluginId, effectId: string, message: string): void {
  pluginDiagnostics.record({
    level: 'error',
    pluginId,
    capability: 'runtimeEffect',
    message: effectId ? `${effectId}: ${message}` : message,
  });
}
