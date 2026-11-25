import type { WindowClosePrompt } from '@linnya/app-lifecycle-contract';
import type { WindowCloseMessageResolver } from '../definitions/windowCloseMessages';

export interface WindowClosePromptPresentation {
  readonly title: string;
  readonly message: string;
  readonly confirmText: string;
  readonly cancelText: string;
}

/** 退出前询问的文案。后果写清楚，不重复解释机制。 */
export function presentWindowClosePrompt(
  prompt: WindowClosePrompt,
  message: WindowCloseMessageResolver,
): WindowClosePromptPresentation {
  const cancelText = message('windowClose.cancel');
  switch (prompt.kind) {
    case 'running_tasks': {
      const count = prompt.scheduled_running_count;
      return {
        title: message('windowClose.exit.title'),
        message: count === 0
          ? message('windowClose.running.commands')
          : message(prompt.has_executing_commands
            ? 'windowClose.running.commandsAndScheduled'
            : 'windowClose.running.scheduled', { count }),
        confirmText: message('windowClose.running.confirm'),
        cancelText,
      };
    }
    case 'activity_unknown':
      return {
        title: message('windowClose.exit.title'),
        message: message('windowClose.unknown.message'),
        confirmText: message('windowClose.confirm.exit'),
        cancelText,
      };
    case 'save_failed':
      return {
        title: message('windowClose.saveFailed.title'),
        message: message('windowClose.saveFailed.message'),
        confirmText: message(prompt.intent === 'install_update'
          ? 'windowClose.confirm.restartUpdate'
          : 'windowClose.confirm.exit'),
        cancelText,
      };
  }
}
