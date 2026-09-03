import { MathFormulaError, type MathFormulaErrorCode } from '@plugin/slides/shared';

export class MathFormulaCompileError extends MathFormulaError {
  constructor(
    readonly code: MathFormulaErrorCode,
    message: string,
  ) {
    super(code, message);
    this.name = 'MathFormulaCompileError';
  }
}
