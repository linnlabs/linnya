import type ts from 'typescript';

export interface CanvasQualitySource {
  readonly path: string; readonly relative: string; readonly text: string; readonly fileLines: number;
  readonly source: ts.SourceFile; readonly lineOffset: number;
}
export interface CanvasQualityIssue {
  readonly rule: string; readonly severity: 'warning' | 'review' | 'error';
  readonly file: string; readonly line: number; readonly function?: string;
  readonly message: string;
}
export interface CanvasQualityException {
  readonly id: string; readonly file: string; readonly function: string;
  readonly rule: 'function-length' | 'complexity' | 'parameters';
  readonly maximum: number; readonly reason: string;
}
