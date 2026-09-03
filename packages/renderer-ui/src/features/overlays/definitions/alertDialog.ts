export interface AlertDialogSection {
  readonly title: string;
  readonly items: readonly string[];
}

export interface AlertDialogProps {
  readonly visible?: boolean;
  readonly message?: string;
  readonly sections?: readonly AlertDialogSection[];
  readonly riskMessage?: string;
  readonly isConfirmation?: boolean;
  readonly title?: string;
  readonly confirmText?: string;
  readonly cancelText?: string;
  readonly isDangerousAction?: boolean;
  readonly closeIsCancel?: boolean;
  readonly width?: string;
  readonly maxWidth?: string;
}
