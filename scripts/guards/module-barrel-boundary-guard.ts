import { listWorkingTreePaths } from '../source-analysis/listWorkingTreePaths';
/** 已完成解环的模块不能从自身聚合入口回引；只约束经过复核的边，不追求全仓零循环。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSourceImports } from '../source-analysis/readSourceImports';

const BLOCK_HISTORY = 'apps/renderer/domains/editor/features/BlockHistory';
const SOURCE_HISTORY = 'packages/plugins/slides/src/backend/features/presentationSourceHistory';
const PERSISTENCE = 'packages/plugins/slides/src/backend/persistence';
const SOURCE_SELECTION = 'packages/plugins/slides/src/renderer/features/sourceSelection';
const TRANSCRIPTION = 'src/features/transcription';
const REVISION_PENDING = 'apps/renderer/domains/editor/features/Revision/utils/pending';
const REVISION_RUNTIME = 'apps/renderer/domains/editor/features/Revision/useRevisionStore';
const BACKEND_SDK = 'src/plugin-sdk/backend';
const PLUGIN_REGISTRY = 'src/app-hosts/linnya/plugin-registry';
const DESKTOP_CAPABILITIES = 'src/app-hosts/linnya/desktop-capabilities';
const RASTER_PDF = 'src/features/system/export/orchestration/renderRasterPdfDocument.ts';
const RUNTIME_QUERY_CONSUMERS = [
  `${PLUGIN_REGISTRY}/registeredContributions.ts`,
  `${PLUGIN_REGISTRY}/toolContextDerivation.ts`,
  'src/app-hosts/linnya/context/agent/registerLinnyaFences.ts',
  'src/tools/agent_control/subrun/subagent/subagentTool.ts',
];
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
    if (edge.typeOnly) return [];
    const target = resolveLocalSourceImport(file, edge.specifier)
      ?.replace(/\.[cm]?[jt]s$/u, '')
      .replace(/\/index$/u, '');
    if (!target) return [];
    const ownBarrel = MODULES.some(root => file.startsWith(`${root}/`) && target === root);
    const historyPersistenceBackEdge =
      (file.startsWith(`${SOURCE_HISTORY}/`) && target === PERSISTENCE) ||
      (file.startsWith(`${PERSISTENCE}/`) && target === SOURCE_HISTORY);
    const revisionRuntimeBackEdge =
      file.startsWith(`${REVISION_PENDING}/`) && target === REVISION_RUNTIME;
    const sdkLoadsPlugins = (file.startsWith(`${BACKEND_SDK}/`) || RUNTIME_QUERY_CONSUMERS.includes(file))
      && (target === `${PLUGIN_REGISTRY}/builtin` || target.startsWith(`${PLUGIN_REGISTRY}/builtin/`));
    const runtimeImportsComposition = target === DESKTOP_CAPABILITIES
      && (file.startsWith(`${BACKEND_SDK}/`) || file.startsWith(`${PLUGIN_REGISTRY}/`) || file === RASTER_PDF);
    return ownBarrel || historyPersistenceBackEdge || revisionRuntimeBackEdge || sdkLoadsPlugins || runtimeImportsComposition
      ? [
          `${file}:${edge.line} → ${edge.specifier}：内部引用应指向具体 definitions/functions/store，不回引聚合 index。`,
        ]
      : [];
  });
}

function main(): void {
  const files = listWorkingTreePaths();
  const violations = files
    .filter(
      file =>
        /\.(?:ts|tsx|js|vue)$/u.test(file) &&
        !/(?:__tests__|fixtures)\/|\.(?:test|spec|example)\./u.test(file) &&
        ([...MODULES, REVISION_PENDING, BACKEND_SDK, PLUGIN_REGISTRY].some(root => file.startsWith(`${root}/`))
          || file === RASTER_PDF || RUNTIME_QUERY_CONSUMERS.includes(file))
    )
    .flatMap(file => findModuleBarrelViolations(file, fs.readFileSync(file, 'utf8')));
  if (violations.length) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  } else console.log('Module barrel boundary guard passed');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main();
