import { registerMessageCatalogs } from '@app/localization';
import { SCHEDULED_TASK_MESSAGE_CATALOG } from '../definitions/scheduledTaskMessageCatalog';

let registered = false;

export function ensureScheduledTasksLocalizationRegistered(): void {
  if (registered) return;
  registerMessageCatalogs(SCHEDULED_TASK_MESSAGE_CATALOG);
  registered = true;
}
