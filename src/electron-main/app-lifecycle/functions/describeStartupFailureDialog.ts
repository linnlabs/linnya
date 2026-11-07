import type {
  AppServerStartupFailure,
  AppServerStartupFailureReason,
} from '../../../app-hosts/linnya/app-server-control';
import type {
  StartupFailureDialogContext,
  StartupFailureDialogView,
} from '../definitions/startupFailureDialog';

interface ReasonCopy {
  readonly headline: string;
  readonly action: string;
}

interface DialogCopy {
  readonly title: string;
  readonly copiedNotice: string;
  readonly buttons: StartupFailureDialogView['buttons'];
  readonly unchanged: string;
  readonly migrationStep: (fromVersion: number, toVersion: number) => string;
  readonly errorLabel: string;
  readonly reasons: Readonly<Record<AppServerStartupFailureReason, ReasonCopy>>;
}

const COPIES: Readonly<Record<'zh' | 'en', DialogCopy>> = Object.freeze({
  zh: Object.freeze({
    title: 'Linnya 启动失败',
    copiedNotice: '诊断信息已复制。',
    buttons: ['重新启动', '复制诊断信息', '退出'] as const,
    unchanged: '原数据没有改动。',
    migrationStep: (from: number, to: number) =>
      `数据升级停在 v${from} → v${to} 这一步：这一步已经回滚，之前完成的步骤保留。`,
    errorLabel: '错误：',
    reasons: Object.freeze({
      disk_full: {
        headline: '磁盘空间不足，Linnya 无法启动',
        action: '请释放磁盘空间，然后重新启动。',
      },
      cannot_access: {
        headline: '无法读写 Linnya 的数据目录',
        action: '请确认数据目录存在、所在磁盘已连接，并且当前用户有读写权限，然后重新启动。',
      },
      io_error: {
        headline: '读写磁盘时出错',
        action: '请确认数据所在的磁盘已连接且工作正常，然后重新启动。不要删除或移动数据目录。',
      },
      busy: {
        headline: '数据正被另一个程序占用',
        action: '可能有另一个 Linnya 正在使用这份数据。请关闭它，然后重新启动。',
      },
      older_data: {
        headline: '这份数据来自更早的版本',
        action: '当前版本无法直接升级或打开它。请保留完整的数据目录和旧版 Linnya，用旧版继续使用；不要删除或重置数据。',
      },
      newer_data: {
        headline: '这份数据来自更新的版本',
        action: '当前版本无法打开它。请安装最新版 Linnya。',
      },
      migration_failed: {
        headline: '数据升级没有完成',
        action: '重新启动会从这一步重试；如果仍然失败，请复制诊断信息发给我们，等待修正版。',
      },
      corrupt: {
        headline: '数据文件已损坏',
        action: 'Linnya 读到的数据库文件不完整或已损坏。请不要删除、移动或覆盖数据目录，复制诊断信息发给我们。',
      },
      unknown: {
        headline: 'Linnya 启动失败',
        action: '请复制诊断信息发给我们。',
      },
    }),
  }),
  en: Object.freeze({
    title: 'Linnya could not start',
    copiedNotice: 'Diagnostics copied.',
    buttons: ['Restart', 'Copy Diagnostics', 'Quit'] as const,
    unchanged: 'Your data has not been changed.',
    migrationStep: (from: number, to: number) =>
      `The data upgrade stopped at v${from} → v${to}. That step was rolled back; earlier steps are kept.`,
    errorLabel: 'Error: ',
    reasons: Object.freeze({
      disk_full: {
        headline: 'Not enough disk space to start Linnya',
        action: 'Free up disk space, then restart.',
      },
      cannot_access: {
        headline: 'Linnya cannot read or write its data folder',
        action: 'Make sure the data folder exists, its disk is connected, and you have read and write permission, then restart.',
      },
      io_error: {
        headline: 'A disk read or write failed',
        action: 'Make sure the disk that holds your data is connected and working, then restart. Do not delete or move the data folder.',
      },
      busy: {
        headline: 'Your data is in use by another program',
        action: 'Another copy of Linnya may be using this data. Close it, then restart.',
      },
      older_data: {
        headline: 'This data was created by an older version',
        action: 'This version cannot upgrade or open it directly. Keep the whole data folder and the older Linnya, and keep using the older version. Do not delete or reset the data.',
      },
      newer_data: {
        headline: 'This data was created by a newer version',
        action: 'This version cannot open it. Install the latest Linnya.',
      },
      migration_failed: {
        headline: 'The data upgrade did not finish',
        action: 'Restarting retries this step. If it still fails, copy the diagnostics and send them to us, then wait for a fixed version.',
      },
      corrupt: {
        headline: 'The data file is damaged',
        action: 'The database file Linnya read is incomplete or damaged. Do not delete, move, or overwrite the data folder. Copy the diagnostics and send them to us.',
      },
      unknown: {
        headline: 'Linnya could not start',
        action: 'Copy the diagnostics and send them to us.',
      },
    }),
  }),
});

/** 版本准入在任何写入之前拒绝，只有这两类可以如实说“数据没有改动”。 */
const UNCHANGED_REASONS: ReadonlySet<AppServerStartupFailureReason> = new Set([
  'older_data',
  'newer_data',
]);

/**
 * 生成启动失败对话框的文案与可复制的诊断信息。
 *
 * 诊断只含版本、系统、类别、错误码、迁移步骤、数据目录和错误文案；用户主目录写成 `~`。
 * 不含正文、文件名列表或凭据。
 */
export function describeStartupFailureDialog(input: {
  readonly failure: AppServerStartupFailure;
  readonly errorMessage: string;
  readonly context: StartupFailureDialogContext;
}): StartupFailureDialogView {
  const { failure, context } = input;
  const copy = context.locale.toLowerCase().startsWith('zh') ? COPIES.zh : COPIES.en;
  const reasonCopy = copy.reasons[failure.reason];
  const errorMessage = redactHome(input.errorMessage, context.homeDirectory);
  const paragraphs: string[] = [];
  if (failure.migration_from_version !== null) {
    paragraphs.push(
      copy.migrationStep(failure.migration_from_version, failure.migration_from_version + 1),
    );
  } else if (UNCHANGED_REASONS.has(failure.reason)) {
    paragraphs.push(copy.unchanged);
  }
  paragraphs.push(reasonCopy.action);
  if (failure.reason === 'unknown' && errorMessage.length > 0) {
    paragraphs.push(`${copy.errorLabel}${errorMessage}`);
  }
  return Object.freeze({
    title: copy.title,
    headline: reasonCopy.headline,
    detail: paragraphs.join('\n\n'),
    copiedNotice: copy.copiedNotice,
    buttons: copy.buttons,
    diagnostics: formatDiagnostics(failure, errorMessage, context),
  });
}

function formatDiagnostics(
  failure: AppServerStartupFailure,
  errorMessage: string,
  context: StartupFailureDialogContext,
): string {
  const lines = [
    'Linnya startup diagnostics',
    `version: ${context.applicationVersion} (${context.distributionKind})`,
    `os: ${context.platform} ${context.osRelease} ${context.arch}`,
    `reason: ${failure.reason}`,
    `code: ${failure.code ?? 'none'}`,
    `migration: ${
      failure.migration_from_version === null
        ? 'none'
        : `v${failure.migration_from_version} -> v${failure.migration_from_version + 1}`
    }`,
    `data: ${context.dataDirectory === null ? 'unknown' : redactHome(context.dataDirectory, context.homeDirectory)}`,
    `error: ${errorMessage.length > 0 ? errorMessage : 'none'}`,
  ];
  return lines.join('\n');
}

function redactHome(text: string, homeDirectory: string): string {
  if (homeDirectory.length < 2) return text;
  return text.split(homeDirectory).join('~');
}
