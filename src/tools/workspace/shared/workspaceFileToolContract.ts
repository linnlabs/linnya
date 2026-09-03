interface WorkspaceFileArgumentSchema {
  safeParse(input: unknown):
    | { readonly success: true }
    | {
        readonly success: false;
        readonly error: {
          readonly issues: readonly {
            readonly path: readonly (string | number)[];
            readonly message: string;
          }[];
        };
      };
}

/** ToolNode 在 start 前调用具体工具的 owner admission；run 内 parse 只是类型收窄。 */
export function validateWorkspaceFileToolArguments(input: {
  readonly args: Record<string, unknown>;
  readonly schema: WorkspaceFileArgumentSchema;
  readonly errorCode: string;
  readonly toolName: string;
}): { success: boolean; error?: string } {
  const parsed = input.schema.safeParse(input.args);
  if (parsed.success) {
    return { success: true };
  }
  const details = parsed.error.issues
    .map(issue => `${issue.path.length > 0 ? issue.path.join('.') : 'arguments'}: ${issue.message}`)
    .join('; ');
  return {
    success: false,
    error: `[${input.errorCode}] ${input.toolName} 参数不符合正式合同: ${details}`,
  };
}
