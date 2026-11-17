import type { AlertDialogSection } from '@linnya/renderer-ui';

/**
 * 对话级档位与定时任务预览共用的档位文案。
 * 档位名称、说明和完全访问确认框沿用设置页“命令权限”的现有文案，便于对照。
 */
export type PermissionTier = 'read_only' | 'standard' | 'full_access';

/** 对话的档位设置：跟随全局，或单独指定一档。 */
export type ConversationTierSetting = PermissionTier | 'global';

export const PERMISSION_TIERS: readonly PermissionTier[] = ['read_only', 'standard', 'full_access'];

export const TIER_LABELS: Readonly<Record<PermissionTier, string>> = {
  read_only: '只读',
  standard: '标准',
  full_access: '完全访问',
};

export const TIER_DESCRIPTIONS: Readonly<Record<PermissionTier, string>> = {
  read_only: '默认只允许读取；超出权限的操作需要批准。',
  standard: '命中固定高风险规则的命令需要批准。',
  full_access: '自动允许所有命令，但会极大增加风险。',
};

export function resolveTier(setting: ConversationTierSetting, globalTier: PermissionTier): PermissionTier {
  return setting === 'global' ? globalTier : setting;
}

/** 输入框里显示的档位文字，例如“标准（跟随全局）”。 */
export function tierSettingText(setting: ConversationTierSetting, globalTier: PermissionTier): string {
  return setting === 'global' ? `${TIER_LABELS[globalTier]}（跟随全局）` : TIER_LABELS[setting];
}

export interface FullAccessDialogCopy {
  readonly title: string;
  readonly message: string;
  readonly sections: readonly AlertDialogSection[];
  readonly riskMessage: string;
  readonly confirmText: string;
  readonly cancelText: string;
}

const SETTINGS_FULL_ACCESS_DIALOG: FullAccessDialogCopy = {
  title: '开启完全访问',
  message: 'Linnya 将能够在未经您许可的情况下，在这台计算机上运行任何命令、访问互联网、创建和编辑文件。\n\n这包括但不限于：',
  sections: [
    { title: '文件和文件夹', items: ['读取、创建、修改、上传或删除文件'] },
    { title: '终端命令', items: ['运行命令、安装软件和更改系统设置', '访问互联网、下载文件、发送数据等'] },
  ],
  riskMessage: '这会带来敏感数据丢失、泄露、提示词注入等风险。',
  confirmText: '接受风险，确认开启',
  cancelText: '取消',
};

/**
 * 定时任务额外的一段警告。用户初稿里列举的删除、上传、安装等操作与上面的清单重复，
 * 这里改为“上面这些操作”，让整个确认框在常见窗口高度里不必滚动；称呼随设置页用“您”。
 */
const SCHEDULED_TASK_WARNING =
  '定时任务会在您不在场时自动运行。Agent 可能在您不知情的情况下执行上面这些操作，或者访问可疑网站；网页或文件里的恶意内容也可能诱导它这么做，而且没有人能当场阻止。除非您明确知道如何应对这些风险，请不要在定时任务里安排可能涉及这类操作的工作。';

export function fullAccessDialogCopy(context: 'conversation' | 'scheduled-task'): FullAccessDialogCopy {
  if (context === 'conversation') {
    return { ...SETTINGS_FULL_ACCESS_DIALOG, title: '这个对话开启完全访问' };
  }
  return {
    ...SETTINGS_FULL_ACCESS_DIALOG,
    title: '定时任务开启完全访问',
    riskMessage: `${SETTINGS_FULL_ACCESS_DIALOG.riskMessage}\n${SCHEDULED_TASK_WARNING}`,
  };
}
