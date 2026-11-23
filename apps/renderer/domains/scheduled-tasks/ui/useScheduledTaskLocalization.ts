import { useLocalization } from '@app/localization';
import { SCHEDULED_TASK_MESSAGE_FALLBACKS } from '../definitions/scheduledTaskMessageCatalog';
import type { ScheduledTaskMessageResolver } from '../definitions/scheduledTaskMessages';
import { ensureScheduledTasksLocalizationRegistered } from '../orchestration/ensureScheduledTasksLocalizationRegistered';

export function useScheduledTaskLocalization() {
  ensureScheduledTasksLocalizationRegistered();
  const { currentLocale, message } = useLocalization();
  const scheduledTaskMessage: ScheduledTaskMessageResolver = (key, params) =>
    message(key, SCHEDULED_TASK_MESSAGE_FALLBACKS[key], params);
  return { currentLocale, scheduledTaskMessage };
}
