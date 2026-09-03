import type { ParseWarning } from '../../compose/inputParsers/parseContext';
import type { ParseCodegenDiagnostic } from '../definitions/codegenDiagnostic';

export function mapParseWarningsToCodegenDiagnostics(
  warnings: readonly ParseWarning[],
): ParseCodegenDiagnostic[] {
  return warnings.map((warning) => ({
    phase: 'parse',
    severity: warning.severity === 'warn' ? 'warning' : 'info',
    code: warning.code,
    message: warning.message,
    ...(warning.hint ? { hint: warning.hint } : {}),
    path: warning.path,
  }));
}
