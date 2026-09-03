export type ContributedAssistantRunCancellation = () => void;

const cancellations = new Set<ContributedAssistantRunCancellation>();

export function registerContributedAssistantRunCancellation(
  cancel: ContributedAssistantRunCancellation,
): () => void {
  cancellations.add(cancel);
  return () => cancellations.delete(cancel);
}

export function cancelContributedAssistantRuns(): void {
  for (const cancel of cancellations) cancel();
}
