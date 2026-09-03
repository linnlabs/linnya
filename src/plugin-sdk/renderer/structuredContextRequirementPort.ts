import type {
  RendererStructuredContextRequirement,
  RendererStructuredContextRequirementInput,
  RendererStructuredContextRequirementResult,
} from '@linnya/plugin-host-contract/renderer/structuredContextRequirementPort';

export type {
  RendererStructuredContextRequirement,
  RendererStructuredContextRequirementInput,
  RendererStructuredContextRequirementResult,
} from '@linnya/plugin-host-contract/renderer/structuredContextRequirementPort';

const requirementsById = new Map<string, RendererStructuredContextRequirement>();

export function registerRendererStructuredContextRequirement(
  requirement: RendererStructuredContextRequirement,
): void {
  if (requirementsById.has(requirement.id)) return;
  requirementsById.set(requirement.id, requirement);
}

export function unregisterRendererStructuredContextRequirement(id: string): void {
  requirementsById.delete(id);
}

export function validateRendererStructuredContextRequirements(
  input: RendererStructuredContextRequirementInput,
): RendererStructuredContextRequirementResult {
  for (const requirement of requirementsById.values()) {
    const result = requirement.validate(input);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true };
}

export function clearRendererStructuredContextRequirementsForTest(): void {
  requirementsById.clear();
}
