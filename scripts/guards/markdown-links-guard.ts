/**
 * 全仓 Markdown 链接门禁：每个 Markdown 文件里的仓库内链接都不能越出仓库根，目标必须在仓库里，锚点必须存在。
 *
 * 公开读者只能看到仓库内容。指向仓库外或本机被忽略文件的链接，在 GitHub 上是坏链接，在开发机上还会
 * 悄悄指到相邻的私有目录，所以按 Git 文件清单而不是磁盘判断。规则见 docs/development/documentation.md。
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { listWorkingTreePaths } from '../source-analysis/listWorkingTreePaths';
import {
  createMarkdownRepository,
  findMarkdownLinkProblems,
  type MarkdownLinkProblem,
  type MarkdownLinkProblemReason,
} from './functions/markdownLocalLinks';

const REASON_TEXT: Record<MarkdownLinkProblemReason, string> = {
  'invalid-link': '链接无法解析',
  'outside-repository': '指向仓库外',
  'missing-target': '目标不在仓库里',
  'missing-anchor': '标题锚点不存在',
};

export function runMarkdownLinksGuard(): { readonly checked: number; readonly problems: MarkdownLinkProblem[] } {
  const files = listWorkingTreePaths();
  const repository = createMarkdownRepository(files, file => fs.readFileSync(file, 'utf8'));
  const markdownFiles = files.filter(file => file.endsWith('.md'));
  const problems = markdownFiles.flatMap(file => findMarkdownLinkProblems(file, fs.readFileSync(file, 'utf8'), repository));
  return { checked: markdownFiles.length, problems };
}

function main(): void {
  const { checked, problems } = runMarkdownLinksGuard();
  if (problems.length === 0) {
    console.log(`[markdown-links-guard] 通过：${checked} 份 Markdown 的仓库内链接均有效。`);
    return;
  }
  console.error('[markdown-links-guard] Markdown 仓库内链接失效：');
  for (const problem of problems) {
    console.error(`  ${problem.file}:${problem.line} ${REASON_TEXT[problem.reason]}：${problem.destination}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
