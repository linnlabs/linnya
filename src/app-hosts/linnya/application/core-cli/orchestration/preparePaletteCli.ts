import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ColorPaletteSuggestion } from '@app/schemas';
import type {
  BackendPluginCliAccessPlan,
  BackendPluginCliPreparation,
  BackendPluginCliResult,
} from '@linnya/plugin-host-contract/backend';
import {
  checkColorPalette,
  createSqliteColorPaletteHistory,
  renderPalettePreview,
  suggestColorPalettes,
  useColorPalette,
} from 'src/domains/color-palette';
import { encodeRgbaPng } from 'src/shared/media/image-pixels';
import type { PhysicalFileReaderPort } from '../../file-read';
import { formatPaletteCheck, formatPaletteSuggestion, formatPaletteUse } from '../functions/formatPalette';
import { PALETTE_USAGE, parsePaletteCommand, type PaletteCommand } from '../functions/parsePaletteCommand';
import { readConversationImage } from './conversationImageFiles';

/** 读不出的图片交回空 bytes，由 domain 统一按跳过处理并判断是否全军覆没。 */
const UNREADABLE = new Uint8Array();

function access(
  internalDataAccess: BackendPluginCliAccessPlan['internalDataAccess'],
  conversationFiles: BackendPluginCliAccessPlan['conversationFiles'],
): BackendPluginCliAccessPlan {
  return {
    internalDataAccess, conversationFiles, externalFiles: 'denied',
    network: 'denied', guiControl: 'denied', localIpcControl: 'denied',
  };
}

function completed(exitCode: number, stdout: string, stderr: string): BackendPluginCliPreparation {
  return { status: 'completed', result: { exitCode, stdout, stderr } };
}

/** 文件名带随机后缀、独占创建，工作目录里预先放好的符号链接不能把写入带到目录外。 */
async function writePreview(root: string, suggestion: ColorPaletteSuggestion, signal: AbortSignal): Promise<string> {
  const png = await encodeRgbaPng(renderPalettePreview(suggestion.palettes));
  const name = `palette-${suggestion.id}-${randomBytes(3).toString('hex')}.png`;
  await writeFile(path.join(root, name), png, { flag: 'wx', mode: 0o600, signal });
  return `conversation:/${name}`;
}

async function executeSuggest(
  command: Extract<PaletteCommand, { kind: 'suggest' }>,
  db: Database.Database,
  reader: PhysicalFileReaderPort,
  root: string,
  signal: AbortSignal,
): Promise<BackendPluginCliResult> {
  const images: Uint8Array[] = [];
  for (const reference of command.images) images.push(await readConversationImage(reader, root, reference, signal) ?? UNREADABLE);
  const outcome = await suggestColorPalettes({ ...command.options, images, signal }, createSqliteColorPaletteHistory(db));
  if (outcome.status === 'failed') return { exitCode: 1, stdout: '', stderr: `${outcome.code} ${outcome.message}\n` };
  const preview = command.preview ? await writePreview(root, outcome.suggestion, signal) : null;
  const skippedImages = outcome.skippedImages.flatMap(index => command.images[index] ?? []);
  const stdout = command.json
    ? `${JSON.stringify({ ...outcome.suggestion, skippedImages, ...(preview ? { preview } : {}) })}\n`
    : formatPaletteSuggestion({ suggestion: outcome.suggestion, skippedImages, preview });
  return { exitCode: 0, stdout, stderr: '' };
}

function executeCheck(command: Extract<PaletteCommand, { kind: 'check' }>): BackendPluginCliResult {
  const outcome = checkColorPalette(command.input);
  if (outcome.status === 'failed') return { exitCode: 1, stdout: '', stderr: `${outcome.code} ${outcome.message}\n` };
  const stdout = command.json ? `${JSON.stringify(outcome.check)}\n` : formatPaletteCheck(outcome.check);
  return { exitCode: outcome.check.ok ? 0 : 1, stdout, stderr: '' };
}

function executeUse(command: Extract<PaletteCommand, { kind: 'use' }>, db: Database.Database): BackendPluginCliResult {
  const outcome = useColorPalette(command.paletteId, createSqliteColorPaletteHistory(db));
  if (outcome.status === 'failed') return { exitCode: 1, stdout: '', stderr: `${outcome.code} ${outcome.message}\n` };
  return { exitCode: 0, stdout: formatPaletteUse(outcome.used), stderr: '' };
}

/**
 * prepare 只解析参数；读图、读写“最近用过”和写预览在通过父 Shell 权限校验后才发生。
 * suggest 会读最近用过并记下发出的编号、use 会写选用记录，都是工作区内部数据的写入，按 write 声明；
 * check 只算颜色，什么都不读写。
 */
export function preparePaletteCli(input: {
  readonly db: Database.Database;
  readonly argv: readonly string[];
  readonly conversationRoot: string;
  readonly fileReader: PhysicalFileReaderPort;
}): BackendPluginCliPreparation {
  let command: PaletteCommand;
  try {
    command = parsePaletteCommand(input.argv);
  } catch (error) {
    const reason = error instanceof Error ? error.message : '参数无效';
    return completed(2, '', `${reason}\n${PALETTE_USAGE}\n`);
  }
  switch (command.kind) {
    case 'help':
      return completed(0, `${PALETTE_USAGE}\n`, '');
    case 'check': {
      const check = command;
      return {
        status: 'ready',
        plan: { access: access('none', 'none'), execute: async () => executeCheck(check) },
      };
    }
    case 'suggest': {
      const suggest = command;
      return {
        status: 'ready',
        plan: {
          access: access('write', suggest.preview ? 'write' : 'none'),
          execute: async ({ signal }) => await executeSuggest(suggest, input.db, input.fileReader, input.conversationRoot, signal),
        },
      };
    }
    case 'use': {
      const use = command;
      return {
        status: 'ready',
        plan: {
          access: access('write', 'none'),
          execute: async ({ signal }) => {
            signal.throwIfAborted();
            return executeUse(use, input.db);
          },
        },
      };
    }
  }
}
