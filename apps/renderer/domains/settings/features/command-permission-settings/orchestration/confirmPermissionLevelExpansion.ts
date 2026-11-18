import { confirm } from '@shared/composables/confirmDialog';
import type { SettingsMessageResolver } from '../../../definitions/settingsMessages';

export function confirmPermissionLevelExpansion(
  settingsMessage: SettingsMessageResolver,
  level: 'standard' | 'full_access',
  /** 对话里沿用设置页的内容，只把标题换成对这个对话说的。 */
  options: { readonly title?: string } = {},
): Promise<boolean> {
  const prefix = level === 'standard'
    ? 'settings.commandPermission.confirmExpansion.standard'
    : 'settings.commandPermission.confirmExpansion.fullAccess';

  return confirm({
    title: options.title ?? settingsMessage(`${prefix}.title`),
    message: settingsMessage(`${prefix}.message`),
    sections: level === 'standard'
      ? [
        {
          title: settingsMessage('settings.commandPermission.confirmExpansion.standard.files.title'),
          items: [
            settingsMessage('settings.commandPermission.confirmExpansion.standard.files.scope'),
            settingsMessage('settings.commandPermission.confirmExpansion.standard.files.riskyOperations'),
          ],
        },
        {
          title: settingsMessage('settings.commandPermission.confirmExpansion.standard.commands.title'),
          items: [
            settingsMessage('settings.commandPermission.confirmExpansion.standard.commands.run'),
            settingsMessage('settings.commandPermission.confirmExpansion.standard.commands.network'),
          ],
        },
      ]
      : [
        {
          title: settingsMessage('settings.commandPermission.confirmExpansion.fullAccess.files.title'),
          items: [
            settingsMessage('settings.commandPermission.confirmExpansion.fullAccess.files.operations'),
          ],
        },
        {
          title: settingsMessage('settings.commandPermission.confirmExpansion.fullAccess.commands.title'),
          items: [
            settingsMessage('settings.commandPermission.confirmExpansion.fullAccess.commands.run'),
            settingsMessage('settings.commandPermission.confirmExpansion.fullAccess.commands.network'),
          ],
        },
      ],
    riskMessage: settingsMessage(`${prefix}.risk`),
    confirmText: settingsMessage('settings.commandPermission.confirmExpansion.confirm'),
    cancelText: settingsMessage('settings.commandPermission.confirmExpansion.cancel'),
    isDangerousAction: true,
    width: '520px',
  });
}
