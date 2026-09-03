import type { SandboxJsonValue, SandboxProfile } from './types.js';

export interface SandboxProfileRegistrationOptions {
  readonly replace?: boolean;
}

export class SandboxProfileRegistry {
  private readonly profiles = new Map<string, SandboxProfile<SandboxJsonValue | undefined>>();

  register<TValue extends SandboxJsonValue | undefined>(
    profile: SandboxProfile<TValue>,
    options: SandboxProfileRegistrationOptions = {},
  ): void {
    const profileId = normalizeProfileId(profile.id);
    if (this.profiles.has(profileId) && options.replace !== true) {
      throw new Error(`SandboxProfile.id 已注册: ${profileId}`);
    }
    this.profiles.set(profileId, profile);
  }

  get<TValue extends SandboxJsonValue | undefined>(profileId: string): SandboxProfile<TValue> | null {
    const normalized = normalizeProfileIdOrNull(profileId);
    if (!normalized) return null;
    const profile = this.profiles.get(normalized);
    return (profile as SandboxProfile<TValue> | undefined) ?? null;
  }

  has(profileId: string): boolean {
    const normalized = normalizeProfileIdOrNull(profileId);
    return normalized ? this.profiles.has(normalized) : false;
  }

  unregister(profileId: string): boolean {
    const normalized = normalizeProfileIdOrNull(profileId);
    return normalized ? this.profiles.delete(normalized) : false;
  }

  list(): readonly SandboxProfile<SandboxJsonValue | undefined>[] {
    return Array.from(this.profiles.values());
  }

  listIds(): readonly string[] {
    return Array.from(this.profiles.keys());
  }
}

function normalizeProfileId(profileId: string): string {
  const normalized = normalizeProfileIdOrNull(profileId);
  if (!normalized) {
    throw new Error('SandboxProfile.id 不能为空');
  }
  return normalized;
}

function normalizeProfileIdOrNull(profileId: string): string | null {
  const normalized = profileId.trim();
  return normalized.length > 0 ? normalized : null;
}
