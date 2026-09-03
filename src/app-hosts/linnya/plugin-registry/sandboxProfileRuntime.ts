import type { PluginId } from '@app/schemas';
import { getDefaultSandboxService } from '../../../features/sandbox/sandboxCompositionRoot';
import { pluginDiagnostics } from './diagnostics';
import type { BackendPluginSandboxProfileRegistration } from './registry';

interface ManagedSandboxProfile {
  readonly pluginId: PluginId;
}

const managedProfiles = new Map<string, ManagedSandboxProfile>();

export function syncBackendPluginSandboxProfiles(
  registrations: readonly BackendPluginSandboxProfileRegistration[],
): void {
  const desired = buildDesiredProfileMap(registrations);
  const sandboxService = getDefaultSandboxService();

  for (const profileId of managedProfiles.keys()) {
    if (!desired.has(profileId)) {
      sandboxService.unregisterProfile(profileId);
      managedProfiles.delete(profileId);
    }
  }

  for (const [profileId, registration] of desired) {
    const managed = managedProfiles.get(profileId);
    if (!managed && sandboxService.hasProfile(profileId)) {
      const message = `sandbox profile 已被非插件运行态注册，拒绝覆盖: ${profileId}`;
      pluginDiagnostics.record({
        level: 'error',
        pluginId: registration.pluginId,
        capability: 'sandboxProfile',
        message,
      });
      throw new Error(`[plugin-registry] ${message}`);
    }

    sandboxService.registerProfile(registration.profile, { replace: managed?.pluginId === registration.pluginId });
    managedProfiles.set(profileId, { pluginId: registration.pluginId });
  }
}

export function clearSyncedBackendPluginSandboxProfilesForTests(): void {
  const sandboxService = getDefaultSandboxService();
  for (const profileId of managedProfiles.keys()) {
    sandboxService.unregisterProfile(profileId);
  }
  managedProfiles.clear();
}

function buildDesiredProfileMap(
  registrations: readonly BackendPluginSandboxProfileRegistration[],
): Map<string, BackendPluginSandboxProfileRegistration> {
  const desired = new Map<string, BackendPluginSandboxProfileRegistration>();
  for (const registration of registrations) {
    const profileId = normalizeProfileId(registration.profile.id, registration.pluginId);
    const existing = desired.get(profileId);
    if (existing) {
      const message = `sandbox profile id 冲突: ${profileId} (${existing.pluginId}, ${registration.pluginId})`;
      pluginDiagnostics.record({
        level: 'error',
        pluginId: registration.pluginId,
        capability: 'sandboxProfile',
        message,
      });
      throw new Error(`[plugin-registry] ${message}`);
    }
    desired.set(profileId, registration);
  }
  return desired;
}

function normalizeProfileId(profileId: string, pluginId: PluginId): string {
  const normalized = profileId.trim();
  if (normalized.length > 0) {
    return normalized;
  }

  const message = `插件声明了空 sandbox profile id: ${pluginId}`;
  pluginDiagnostics.record({
    level: 'error',
    pluginId,
    capability: 'sandboxProfile',
    message,
  });
  throw new Error(`[plugin-registry] ${message}`);
}
