export interface WorkspaceNodeDisplayNameLike {
  readonly name?: string | null;
  readonly displayName?: string | null;
  readonly title?: string | null;
}

export function resolveWorkspaceNodeDisplayName(
  node: WorkspaceNodeDisplayNameLike | null | undefined,
  fallbackName: string,
): string {
  const displayName = node?.displayName?.trim();
  if (displayName) return displayName;
  const name = node?.name?.trim();
  if (name) return name;
  const title = node?.title?.trim();
  if (title) return title;
  return fallbackName;
}
