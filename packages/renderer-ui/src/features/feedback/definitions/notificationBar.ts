export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface NotificationBarProps {
  readonly visible?: boolean;
  readonly message: string;
  readonly type?: NotificationType;
  readonly right?: number;
}
