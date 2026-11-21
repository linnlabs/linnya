import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ProbeError, repoRoot } from '../definitions/probeContract.mjs';
import { connectCdp, findPage } from '../infrastructure/cdpClient.mjs';
import {
  developmentAttachmentFile, developmentLogDirectory, readDevelopmentAttachment,
} from '../../dev-attach/functions/developmentAttachment.mjs';

/** 附着到用户日常 dev:electron 会话时只允许这些只读命令；不点击、不输入、不重启也不关闭。 */
export const ATTACH_COMMANDS = new Set(['status', 'snapshot', 'shot', 'eval', 'wait', 'logs', 'fonts']);

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function todayStamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 读取本 worktree dev:electron 写下的附着信息，组装成探针页面命令可用的只读会话。 */
export function readAttachedSession() {
  const file = developmentAttachmentFile(repoRoot);
  const attachment = readDevelopmentAttachment(file);
  if (!attachment) {
    throw new ProbeError('NOT_RUNNING', '本 worktree 没有正在运行的 dev:electron 会话',
      '在本 worktree 运行 pnpm run dev:electron 后再附着；旧会话需重启才会开放附着端口');
  }
  if (!processAlive(attachment.launcherPid)) {
    throw new ProbeError('NOT_RUNNING', 'dev:electron 会话已经退出（附着记录已过期）', '重新运行 pnpm run dev:electron');
  }
  const root = path.join(path.dirname(file), 'probe-attach');
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const rendererLog = path.join(developmentLogDirectory(repoRoot), `renderer-${todayStamp()}.jsonl`);
  return {
    state: 'ready', attached: true, root, cdpPort: attachment.cdpPort, viteUrl: attachment.viteUrl,
    startedAt: attachment.startedAt, options: { name: 'dev:electron（只读附着）' },
    logs: { renderer: rendererLog },
    rendererLogPresent: existsSync(rendererLog),
  };
}

export async function connectAttachedPage(session) {
  const target = await findPage(session.cdpPort, new URL(session.viteUrl).origin)
    .catch(() => { throw new ProbeError('NOT_RUNNING', '连不上 dev:electron 的调试端口', '会话可能刚退出，重新运行 pnpm run dev:electron'); });
  if (!target) throw new ProbeError('NOT_RUNNING', '找不到 dev:electron 的主窗口 Renderer');
  return connectCdp(target.webSocketDebuggerUrl);
}

export function assertAttachCommand(command, values) {
  if (!ATTACH_COMMANDS.has(command)) {
    throw new ProbeError('USAGE', `--attach 只支持只读命令：${[...ATTACH_COMMANDS].join('、')}`,
      '点击、输入等会改动用户会话的操作请在隔离探针实例里做：pnpm -s probe up');
  }
  if (command === 'eval' && values.main) throw new ProbeError('USAGE', '--attach 不支持 eval --main');
  if (command === 'logs' && values.source && values.source !== 'renderer') {
    throw new ProbeError('USAGE', '--attach 只提供 Renderer 控制台日志（_dev_data/logs/renderer-<日期>.jsonl）');
  }
}
