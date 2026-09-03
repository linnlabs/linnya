import type { PluginId } from '@app/schemas';
import { pluginDiagnostics } from './diagnostics';
import type { BackendPluginRuntimeEffectRegistration } from './registry';

interface ActiveRuntimeEffect {
  readonly pluginId: PluginId;
  readonly effectId: string;
  readonly deactivate: () => void | Promise<void>;
}

const activeEffects = new Map<string, ActiveRuntimeEffect>();

export async function syncBackendPluginRuntimeEffects(
  registrations: readonly BackendPluginRuntimeEffectRegistration[],
): Promise<void> {
  const desired = buildDesiredEffectMap(registrations);
  await deactivateStaleRuntimeEffects(desired);
  await activateDesiredRuntimeEffects(desired);
}

export async function deactivateStaleBackendPluginRuntimeEffects(
  registrations: readonly BackendPluginRuntimeEffectRegistration[],
): Promise<void> {
  const desired = buildDesiredEffectMap(registrations);
  await deactivateStaleRuntimeEffects(desired);
}

export async function activateDesiredBackendPluginRuntimeEffects(
  registrations: readonly BackendPluginRuntimeEffectRegistration[],
): Promise<void> {
  const desired = buildDesiredEffectMap(registrations);
  await activateDesiredRuntimeEffects(desired);
}

async function deactivateStaleRuntimeEffects(
  desired: ReadonlyMap<string, BackendPluginRuntimeEffectRegistration>,
): Promise<void> {
  for (const [effectKey, active] of activeEffects) {
    if (!desired.has(effectKey)) {
      await runEffectStep(active.pluginId, active.effectId, 'deactivate', active.deactivate);
      activeEffects.delete(effectKey);
    }
  }
}

async function activateDesiredRuntimeEffects(
  desired: ReadonlyMap<string, BackendPluginRuntimeEffectRegistration>,
): Promise<void> {
  for (const [effectKey, registration] of desired) {
    if (activeEffects.has(effectKey)) {
      continue;
    }
    await runEffectStep(
      registration.pluginId,
      registration.effect.id,
      'activate',
      registration.effect.activate,
    );
    activeEffects.set(effectKey, {
      pluginId: registration.pluginId,
      effectId: registration.effect.id,
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
  registrations: readonly BackendPluginRuntimeEffectRegistration[],
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
  fn: () => void | Promise<void>,
): Promise<void> {
  try {
    await fn();
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
