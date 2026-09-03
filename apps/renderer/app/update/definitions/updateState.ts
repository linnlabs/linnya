type UpdateInvokeChannel =
  | 'updater-check-for-updates'
  | 'updater-start-download'
  | 'updater-quit-and-install';

export type UpdateErrorInfo =
  | {
      kind: 'dynamic';
      message: string;
    }
  | {
      kind: 'ipc-unavailable';
      channel: UpdateInvokeChannel;
    }
  | null;

export type { UpdateInvokeChannel };
