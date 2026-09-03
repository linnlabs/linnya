import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface ToolDirectoryBoundaryViolation {
  readonly path: string;
  readonly reason: string;
}

const RETIRED_NON_TOOL_PATHS = [
  {
    path: 'src/tools/artifacts',
    reason: 'ToolContext conversation scope 属于 Linnya Host adapter，不是 Agent 工具。',
  },
  {
    path: 'src/tools/citation_snapshot',
    reason: 'CitationSnapshot 只是 Citation domain 的严格历史恢复能力。',
  },
  {
    path: 'src/tools/database',
    reason: '数据库只读诊断属于 scripts/diagnostics，不是 Agent 工具。',
  },
  {
    path: 'src/tools/test',
    reason: '诊断、E2E 与手工实验必须按真实类型进入 scripts，不建立 tools/test 杂物间。',
  },
] as const;

const ALLOWED_ROOT_TYPESCRIPT_FILES = new Set(['index.ts', 'ports.ts', 'types.ts']);

export function collectToolDirectoryBoundaryViolations(
  repositoryRoot = process.cwd(),
): readonly ToolDirectoryBoundaryViolation[] {
  const violations: ToolDirectoryBoundaryViolation[] = RETIRED_NON_TOOL_PATHS.flatMap(entry => (
    fs.existsSync(path.join(repositoryRoot, entry.path)) ? [entry] : []
  ));

  const toolsRoot = path.join(repositoryRoot, 'src/tools');
  if (!fs.existsSync(toolsRoot)) return violations;
  for (const entry of fs.readdirSync(toolsRoot, { withFileTypes: true })) {
    if (
      entry.isFile()
      && entry.name.endsWith('.ts')
      && !ALLOWED_ROOT_TYPESCRIPT_FILES.has(entry.name)
    ) {
      violations.push({
        path: `src/tools/${entry.name}`,
        reason: 'src/tools 顶层只允许公共聚合与合同；维护、诊断和具体工具必须进入真实 owner。',
      });
    }
  }
  return violations;
}

function run(): void {
  const violations = collectToolDirectoryBoundaryViolations();
  if (violations.length === 0) {
    process.stdout.write('[tool-directory-boundary-guard] 通过：非工具目录与根级脚本未回流 src/tools。\n');
    return;
  }
  process.stderr.write('[tool-directory-boundary-guard] 检测到非工具能力回流 src/tools：\n');
  for (const violation of violations) {
    process.stderr.write(`- ${violation.path}\n  ${violation.reason}\n`);
  }
  process.exitCode = 1;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(path.resolve(entryPath)).href) run();
