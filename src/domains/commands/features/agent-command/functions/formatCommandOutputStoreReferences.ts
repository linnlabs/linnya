import type { CommandOutputStore } from '@app/schemas/commands';

type CommandOutputStoreResource = Extract<
  CommandOutputStore,
  { readonly mode: 'pipe' }
>['stdout'];

function formatResource(
  label: 'stdout' | 'stderr' | 'terminal',
  resource: CommandOutputStoreResource,
): string | undefined {
  if (resource.status !== 'published') return undefined;
  const scope = resource.completeness === 'complete' ? 'full output' : 'saved prefix';
  return `${label} ${scope}: blob_id=${resource.blob_id}`
    + ` (reference: tool_output://blobs/${resource.blob_id}; `
    + `${resource.persisted_characters} characters, ${resource.persisted_lines} lines). `
    + `Continue with tool_output_read({"blob_id":"${resource.blob_id}"}).`;
}

/** 只把已发布资源交给 Agent；内部路径和存储失败原因不进入模型上下文。 */
export function formatCommandOutputStoreReferences(store: CommandOutputStore): string {
  const lines = store.mode === 'pipe'
    ? [formatResource('stdout', store.stdout), formatResource('stderr', store.stderr)]
    : [formatResource('terminal', store.terminal)];
  return lines.filter((line): line is string => line !== undefined).join('\n');
}
