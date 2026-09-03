import type { CodegenDiagnostic } from '../definitions/codegenDiagnostic';

const MAX_CODEGEN_DIAGNOSTICS = 20;

export function mergeCodegenDiagnostics(
  ...groups: readonly (readonly CodegenDiagnostic[])[]
): CodegenDiagnostic[] {
  const result: CodegenDiagnostic[] = [];
  const seen = new Set<string>();

  for (const diagnostic of groups.flat()) {
    const key = diagnostic.phase === 'structure'
      ? `${diagnostic.phase}\u0000${diagnostic.code}\u0000${diagnostic.sourceSpan.startLine}`
      : `${diagnostic.phase}\u0000${diagnostic.code}\u0000${diagnostic.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(diagnostic);
    if (result.length >= MAX_CODEGEN_DIAGNOSTICS) return result;
  }

  return result;
}
