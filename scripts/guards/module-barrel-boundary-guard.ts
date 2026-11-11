/** 已完成解环的模块不能从自身聚合入口回引；只约束经过复核的边，不追求全仓零循环。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readSourceImports } from './functions/readSourceImports';

const BLOCK_HISTORY = 'apps/renderer/domains/editor/features/BlockHistory';
const SOURCE_HISTORY = 'packages/plugins/slides/src/backend/features/presentationSourceHistory';
const PERSISTENCE = 'packages/plugins/slides/src/backend/persistence';
const SOURCE_SELECTION = 'packages/plugins/slides/src/renderer/features/sourceSelection';
const TRANSCRIPTION = 'src/features/transcription';
const MODULES = [BLOCK_HISTORY, SOURCE_HISTORY, PERSISTENCE, SOURCE_SELECTION, TRANSCRIPTION];

export function resolveLocalSourceImport(file: string, specifier: string): string | undefined {
  if (specifier.startsWith('.'))
    return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  if (specifier === '@transcription') return TRANSCRIPTION;
  if (specifier.startsWith('@transcription/'))
    return `src/features/transcription/${specifier.slice(15)}`;
  if (specifier.startsWith('@/')) return `apps/renderer/${specifier.slice(2)}`;
  if (specifier.startsWith('@plugin/slides/'))
    return `packages/plugins/slides/src/${specifier.slice(15)}`;
  if (specifier.startsWith('src/')) return specifier;
  return undefined;
}

export function findModuleBarrelViolations(file: string, content: string): string[] {
  return readSourceImports(file, content).flatMap(edge => {
    const target = resolveLocalSourceImport(file, edge.specifier)
      ?.replace(/\.[cm]?[jt]s$/u, '')
      .replace(/\/index$/u, '');
    if (!target) return [];
    const ownBarrel = MODULES.some(root => file.startsWith(`${root}/`) && target === root);
    const historyPersistenceBackEdge =
      (file.startsWith(`${SOURCE_HISTORY}/`) && target === PERSISTENCE) ||
      (file.startsWith(`${PERSISTENCE}/`) && target === SOURCE_HISTORY);
    return ownBarrel || historyPersistenceBackEdge
      ? [
          `${file}:${edge.line} → ${edge.specifier}：内部引用应指向具体 definitions/functions/store，不回引聚合 index。`,
        ]
      : [];
  });
}

function main(): void {
  const files = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' }
  ).split('\0');
  const violations = files
    .filter(
      file =>
        /\.(?:ts|tsx|js|vue)$/u.test(file) &&
        !/(?:__tests__|fixtures)\/|\.(?:test|spec|example)\./u.test(file) &&
        MODULES.some(root => file.startsWith(`${root}/`))
    )
    .flatMap(file => findModuleBarrelViolations(file, fs.readFileSync(file, 'utf8')));
  if (violations.length) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  } else console.log('Module barrel boundary guard passed');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main();
