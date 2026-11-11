export type AuditCategory = 'production' | 'test' | 'tooling' | 'declaration';

export interface SourceAuditFile {
  readonly file: string;
  readonly category: AuditCategory;
  readonly lines: number;
  readonly ast: boolean;
}

export interface AuditLocation {
  readonly file: string;
  readonly line: number;
}

export interface AuditFunction extends AuditLocation {
  readonly name: string;
  readonly end: number;
  readonly tokens: number;
  readonly bodyHash: string;
  readonly async: boolean;
}

export interface AuditSignal extends AuditLocation {
  readonly rule: string;
}

export interface SourceAudit {
  readonly functions: readonly AuditFunction[];
  readonly signals: readonly AuditSignal[];
  readonly parseErrors: readonly string[];
}
