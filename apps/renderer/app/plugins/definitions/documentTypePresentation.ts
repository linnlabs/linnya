export interface DocumentTypeRecoveryAction {
  readonly label: string;
  activate(): Promise<void>;
}
