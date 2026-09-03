import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ReleaseNotesInfo } from '../definitions/releaseManifest';

const RELEASE_TITLE_PATTERN = /^测试版 v(\d+\.\d+\.\d+)\s*$/;

export function parseReleaseNotesMarkdown(rawMarkdown: string): ReleaseNotesInfo {
  const lines = rawMarkdown.split(/\r?\n/);
  const title = lines.find((line) => line.trim().length > 0)?.trim() ?? '';
  const match = RELEASE_TITLE_PATTERN.exec(title);

  if (!match) {
    throw new Error('release-notes.md 第一行必须是“测试版 vX.Y.Z”。');
  }

  const version = match[1];
  if (!version) {
    throw new Error('release-notes.md 标题缺少版本号。');
  }

  const notes = lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-') || line.startsWith(' -'))
    .map((line) => line.replace(/^\s*-\s*/, '').trim())
    .filter((line) => line.length > 0);

  return {
    title,
    version,
    notes,
    rawMarkdown,
  };
}

export function readReleaseNotes(rootDir: string): ReleaseNotesInfo {
  const notesPath = path.join(rootDir, 'release-notes.md');
  return parseReleaseNotesMarkdown(fs.readFileSync(notesPath, 'utf-8'));
}

export function buildCurrentReleaseModule(notes: ReleaseNotesInfo): string {
  const payload = {
    version: notes.version,
    title: notes.title,
    notes: notes.notes,
    rawMarkdown: notes.rawMarkdown,
  };

  return [
    '// 本文件由 scripts/release/orchestration/generateCurrentRelease.ts 生成。',
    '// 请只修改根目录 release-notes.md，然后运行 pnpm run release:generate。',
    '',
    `export const currentRelease = ${JSON.stringify(payload, null, 2)} as const;`,
    '',
  ].join('\n');
}
