export function normalizeSourceSelectionIds(elementIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const elementId of elementIds) {
    if (seen.has(elementId)) {
      continue;
    }
    seen.add(elementId);
    normalized.push(elementId);
  }
  return normalized;
}

export function resolveSourceElementClickSelection(input: {
  currentElementIds: readonly string[];
  clickedElementId: string;
  additive: boolean;
}): string[] {
  if (!input.additive) {
    return [input.clickedElementId];
  }

  if (input.currentElementIds.includes(input.clickedElementId)) {
    return input.currentElementIds.filter((elementId) => elementId !== input.clickedElementId);
  }

  return normalizeSourceSelectionIds([
    ...input.currentElementIds,
    input.clickedElementId,
  ]);
}

export function resolveSourceMarqueeSelection(input: {
  currentElementIds: readonly string[];
  marqueeElementIds: readonly string[];
  additive: boolean;
}): string[] {
  if (!input.additive) {
    return normalizeSourceSelectionIds(input.marqueeElementIds);
  }

  return normalizeSourceSelectionIds([
    ...input.currentElementIds,
    ...input.marqueeElementIds,
  ]);
}
