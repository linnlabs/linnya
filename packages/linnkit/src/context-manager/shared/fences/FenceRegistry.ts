import type { AgentContextInjection } from '../../../ports';

export type FenceLlmRole = 'user' | 'system';
export type FencePlacement =
  | 'after-system'
  | 'before-current-user'
  | 'after-current-user'
  | 'after-last-tool-result';
export type FenceLifetime = 'turn-only' | 'persisted';

export interface FenceDescriptor {
  kind: string;
  llmRole: FenceLlmRole;
  placement: FencePlacement;
  lifetime: FenceLifetime;
  mustKeep?: boolean;
  maxBudgetFraction?: number;
  formatter: (content: string, attrs: Record<string, unknown>) => string;
}

export type FenceInjection = AgentContextInjection;

export interface FenceRegistry {
  register(descriptor: FenceDescriptor): void;
  get(kind: string): FenceDescriptor | undefined;
  list(): FenceDescriptor[];
}

const FENCE_KIND_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

class DefaultFenceRegistry implements FenceRegistry {
  private readonly descriptors = new Map<string, FenceDescriptor>();

  register(descriptor: FenceDescriptor): void {
    validateDescriptor(descriptor);
    if (this.descriptors.has(descriptor.kind)) {
      throw new Error(`Fence kind "${descriptor.kind}" is already registered.`);
    }
    this.descriptors.set(descriptor.kind, descriptor);
  }

  get(kind: string): FenceDescriptor | undefined {
    return this.descriptors.get(kind);
  }

  list(): FenceDescriptor[] {
    return [...this.descriptors.values()];
  }
}

export function createFenceRegistry(descriptors: FenceDescriptor[] = []): FenceRegistry {
  const registry = new DefaultFenceRegistry();
  for (const descriptor of descriptors) {
    registry.register(descriptor);
  }
  return registry;
}

function validateDescriptor(descriptor: FenceDescriptor): void {
  if (!FENCE_KIND_PATTERN.test(descriptor.kind)) {
    throw new Error(`Fence kind "${descriptor.kind}" must be kebab-case.`);
  }

  const fraction = descriptor.maxBudgetFraction;
  if (fraction !== undefined && (fraction <= 0 || fraction > 1)) {
    throw new Error('Fence maxBudgetFraction must be within (0, 1].');
  }
}
