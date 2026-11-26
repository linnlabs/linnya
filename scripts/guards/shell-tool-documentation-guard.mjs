import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { removeFencedCode } from './functions/markdownLocalLinks.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const documentationRoots = [
  'src/domains/commands',
  'src/domains/conversation-files',
  'src/domains/audit/features/command-execution-audit',
  'src/app-hosts/linnya/adapters/commands',
  'src/app-hosts/linnya/application/plugin-cli-shell-bridge',
  'src/app-hosts/linnya/application/conversation-lifecycle',
  'src/electron-main/commands',
  'src/infra/adapters/command-runtime',
  'src/infra/adapters/local-process-runtime',
  'src/features/sandbox',
  'src/tools/commands/shell',
  'src/tools/commands/process',
  'src/tools/tool_output',
  'apps/renderer/domains/conversation/features/command-approval',
  'apps/renderer/domains/conversation/features/command-execution-presentation',
];
const violations = [];
const formalDocuments = documentationRoots.flatMap(root => listMarkdownFiles(root));

for (const relativePath of formalDocuments) {
  const source = read(relativePath);
  verifyFences(relativePath, source);
  if (/docs\/bash-tool-(?:research|validation|implementation)|docs\/bash-tool-research\.md/u.test(source)) {
    violations.push(`${relativePath}: 不得引用已删除的旧 Bash 文档体系`);
  }
}

verifyRootNavigation();
verifyNoLongDuplicateParagraphs();
verifyRemovedLegacyPaths();

if (violations.length > 0) {
  process.stderr.write('[shell-tool-documentation-guard] 文档合同不一致：\n');
  for (const violation of violations) process.stderr.write(`  - ${violation}\n`);
  process.exit(1);
}

process.stdout.write(
  `[shell-tool-documentation-guard] 通过：${formalDocuments.length} 份模块文档，入口、代码块、重复内容和旧体系引用检查均有效（链接由 guard:markdown-links 检查）。\n`,
);

function verifyRootNavigation() {
  const root = 'src/domains/commands/README.md';
  const source = read(root);
  const requiredLinks = [
    '../../tools/commands/shell/README.md',
    '../../tools/commands/process/README.md',
    '../../infra/adapters/command-runtime/README.md',
    '../../infra/adapters/local-process-runtime/README.md',
    '../../app-hosts/linnya/adapters/commands/README.md',
    '../conversation-files/README.md',
    '../audit/features/command-execution-audit/README.md',
  ];
  for (const link of requiredLinks) {
    if (!source.includes(`](${link})`)) violations.push(`${root}: 缺少入口链接 ${link}`);
  }
}

function verifyRemovedLegacyPaths() {
  const legacyPaths = [
    'docs/bash-tool-research',
    'docs/bash-tool-validation',
    'docs/bash-tool-implementation',
    'docs/bash-tool-research.md',
  ];
  for (const relativePath of legacyPaths) {
    if (fs.existsSync(path.join(repoRoot, relativePath))) {
      violations.push(`旧文档路径仍存在：${relativePath}`);
    }
  }
}

function verifyFences(relativePath, source) {
  let openFence = null;
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/u);
    if (!match) continue;
    const marker = match[1][0];
    const length = match[1].length;
    if (openFence === null) {
      openFence = { marker, length, line: index + 1 };
    } else if (openFence.marker === marker && length >= openFence.length) {
      openFence = null;
    }
  }
  if (openFence !== null) violations.push(`${relativePath}:${openFence.line}: Markdown 代码块未闭合`);
}

function verifyNoLongDuplicateParagraphs() {
  const paragraphOwners = new Map();
  for (const relativePath of formalDocuments) {
    const paragraphs = removeFencedCode(read(relativePath))
      .split(/\r?\n\s*\r?\n/gu)
      .map(paragraph => paragraph.replace(/\s+/gu, ' ').trim())
      .filter(paragraph => paragraph.length >= 240);
    for (const paragraph of paragraphs) {
      const owner = paragraphOwners.get(paragraph);
      if (owner !== undefined && owner !== relativePath) {
        violations.push(`${relativePath}: 与 ${owner} 存在 240 字符以上的精确重复段落`);
      } else {
        paragraphOwners.set(paragraph, relativePath);
      }
    }
  }
}

function listMarkdownFiles(root) {
  const results = [];
  const visit = relativeDirectory => {
    const absoluteDirectory = path.join(repoRoot, relativeDirectory);
    if (!fs.existsSync(absoluteDirectory)) return;
    for (const entry of fs.readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) visit(relativePath);
      else if (entry.isFile() && entry.name.endsWith('.md')) results.push(relativePath);
    }
  };
  visit(root);
  return results.sort();
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}
