import { watch } from 'vue';
import { formatScheduledDate, formatScheduledTime } from '@app/schemas';
import type { CommandPermissionLevel } from '@app/schemas/commands';
import type { ConversationRunScheduledTask, ScheduledTask } from '@app/schemas/scheduled-tasks';
import { useLocalization } from '@app/localization';
import { useNotificationStore } from '@/app/notification';
import type {
  RunScheduledTaskCard,
  RunScheduledTasksPort,
} from '@/domains/conversation/features/run-scheduled-tasks';
import {
  describeSchedule,
  presentTaskState,
  scheduledTasksClient,
  useScheduledTaskLocalization,
  useScheduledTasksStore,
} from '@/domains/scheduled-tasks';
import { useSettingsLocalization } from '@/domains/settings/public';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';

const OPEN = 'open';
const LOWER_TO_STANDARD = 'lower-to-standard';

/**
 * 回答末尾定时任务卡片的跨域编排：读 App Server 记下的“这一轮建了或改了哪些任务”，
 * 按定时任务的写法给出卡片文字；“查看”进入定时任务页，“改为标准”直接改该任务的档位。
 */
export function createRunScheduledTasksPort(): RunScheduledTasksPort {
  const tasks = new Map<string, ScheduledTask>();

  function levelLabel(level: CommandPermissionLevel): string {
    const { settingsMessage } = useSettingsLocalization();
    switch (level) {
      case 'read_only': return settingsMessage('settings.commandPermission.level.readOnly');
      case 'standard': return settingsMessage('settings.commandPermission.level.standard');
      case 'full_access': return settingsMessage('settings.commandPermission.level.fullAccess');
    }
  }

  function toCard(item: ConversationRunScheduledTask): RunScheduledTaskCard {
    const { scheduledTaskMessage } = useScheduledTaskLocalization();
    const task = item.task;
    if (!task) {
      return {
        taskId: item.task_id,
        name: item.task_name,
        meta: scheduledTaskMessage('scheduledTasks.card.deleted'),
        tone: 'normal',
        warning: null,
        actions: [],
      };
    }
    tasks.set(task.id, task);
    const locale = useLocalization().currentLocale.value;
    const now = Date.now();
    const nextRun = task.next_run_at === null ? null : formatScheduledTime(task.next_run_at, { locale, now });
    const meta = [
      ...(item.action === 'updated' ? [scheduledTaskMessage('scheduledTasks.card.updated')] : []),
      describeSchedule(task.schedule, scheduledTaskMessage, value => formatScheduledDate(value, { locale, now })),
      presentTaskState(task, scheduledTaskMessage, nextRun).text,
      levelLabel(task.permission_level),
    ].join(' · ');
    const fullAccess = task.permission_level === 'full_access';
    const view = { id: OPEN, label: scheduledTaskMessage('scheduledTasks.card.view') };
    return {
      taskId: task.id,
      name: task.name,
      meta,
      tone: fullAccess || item.above_conversation_permission ? 'warning' : 'normal',
      warning: fullAccess
        ? scheduledTaskMessage('scheduledTasks.card.fullAccessWarning')
        : item.above_conversation_permission ? scheduledTaskMessage('scheduledTasks.card.aboveConversation') : null,
      actions: fullAccess
        ? [
          { id: LOWER_TO_STANDARD, label: scheduledTaskMessage('scheduledTasks.card.lowerToStandard'), variant: 'secondary' },
          { ...view, variant: 'ghost' },
        ]
        : [{ ...view, variant: 'secondary' }],
    };
  }

  async function lowerToStandard(task: ScheduledTask): Promise<void> {
    const { scheduledTaskMessage } = useScheduledTaskLocalization();
    const notifications = useNotificationStore();
    const result = await scheduledTasksClient.update({
      task_id: task.id,
      expected_revision: task.revision,
      permission_level: 'standard',
    });
    if (!result.ok) {
      notifications.show(scheduledTaskMessage('scheduledTasks.actionFailed', { reason: result.message }), 'error');
      return;
    }
    tasks.set(result.task.id, result.task);
    useScheduledTasksStore().applyTask(result.task);
    notifications.show(scheduledTaskMessage('scheduledTasks.card.lowered', { name: result.task.name }), 'success');
  }

  return {
    async list(request) {
      const result = await scheduledTasksClient.listForConversationRuns({
        conversation_id: request.conversationId,
        root_run_ids: [...request.rootRunIds],
      });
      return result.tasks.map(toCard);
    },
    async act(card, actionId) {
      const task = tasks.get(card.taskId);
      if (!task) return;
      if (actionId === OPEN) {
        await getWorkspaceNavigationPort().openScheduledTasks({ projectId: task.project_id, scheduledTaskId: task.id });
        return;
      }
      if (actionId === LOWER_TO_STANDARD) await lowerToStandard(task);
    },
    watch(onChange) {
      const store = useScheduledTasksStore();
      return watch(() => store.changeSeq, () => onChange());
    },
  };
}
