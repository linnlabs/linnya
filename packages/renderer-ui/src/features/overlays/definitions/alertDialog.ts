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
  /** 打开后直接按 Enter 执行哪个操作，默认确认；后果严重、可能被误触的确认用 `cancel`。 */
  readonly defaultAction?: 'confirm' | 'cancel';
  readonly width?: string;
  readonly maxWidth?: string;
}
