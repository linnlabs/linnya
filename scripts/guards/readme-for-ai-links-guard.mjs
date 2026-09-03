import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readmePath = path.join(repoRoot, 'README_FOR_AI.md');
const source = fs.readFileSync(readmePath, 'utf8');
const violations = [];

for (const match of removeFencedCode(source).matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
  const rawDestination = match[1].trim().replace(/^<|>$/gu, '');
  const destination = rawDestination.split(/\s+['"]/u, 1)[0];
  if (
    destination.length === 0 ||
    destination.startsWith('#') ||
    /^[a-z][a-z0-9+.-]*:/iu.test(destination)
  )
    continue;

  const filePart = destination.split('#', 1)[0];
  let decodedFilePart;
  try {
    decodedFilePart = decodeURIComponent(filePart);
  } catch {
    violations.push(`无法解析链接：${destination}`);
    continue;
  }

  const targetPath = path.resolve(repoRoot, decodedFilePart);
  const relativeTarget = path.relative(repoRoot, targetPath);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    violations.push(`仓库内入口不得指向仓库外：${destination}`);
  } else if (!fs.existsSync(targetPath)) {
    violations.push(`链接目标不存在：${destination}`);
  }
}

if (violations.length > 0) {
  process.stderr.write('[readme-for-ai-links-guard] README_FOR_AI 链接失效：\n');
  for (const violation of violations) process.stderr.write(`  - ${violation}\n`);
  process.exit(1);
}

process.stdout.write('[readme-for-ai-links-guard] README_FOR_AI 仓库内链接均有效。\n');

function removeFencedCode(markdown) {
  let openFence = null;
  return markdown
    .split(/\r?\n/u)
    .map(line => {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})/u);
      if (match) {
        const marker = match[1][0];
        const length = match[1].length;
        if (openFence === null) openFence = { marker, length };
        else if (openFence.marker === marker && length >= openFence.length) openFence = null;
        return '';
      }
      return openFence === null ? line : '';
    })
    .join('\n');
}
