export interface WorkspaceVfsStatement {
  all(...params: readonly unknown[]): unknown[];
  get(...params: readonly unknown[]): unknown;
  run(...params: readonly unknown[]): unknown;
}
export interface WorkspaceVfsDatabase {
  prepare(sql: string): WorkspaceVfsStatement;
}
