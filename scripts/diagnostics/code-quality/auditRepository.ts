import { listWorkingTreePaths } from '../../source-analysis/listWorkingTreePaths';
/** 只读源码审计：stdout 输出 JSON，不改源码、基线、数据库或 Git index。 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { SourceAuditFile } from './definitions/sourceAudit';
import { analyzeSource } from './functions/analyzeSource';
import {
  AST_PATTERN,
  EXCLUDED_PATTERNS,
  SOURCE_PATTERN,
  categoryFor,
} from './functions/classifySourceFile';

const root = process.cwd();
const candidates = listWorkingTreePaths().filter(file => SOURCE_PATTERN.test(file));
const excluded = candidates.filter(file => EXCLUDED_PATTERNS.some(pattern => pattern.test(file)));
const excludedSet = new Set(excluded);
const files: SourceAuditFile[] = [];
const analyses = candidates
  .filter(file => !excludedSet.has(file))
  .map(file => {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    const category = categoryFor(file);
    const ast = AST_PATTERN.test(file) && category !== 'declaration';
    files.push({
      file,
      category,
      lines: content === '' ? 0 : content.split(/\r?\n/u).length - (content.endsWith('\n') ? 1 : 0),
      ast,
    });
    return ast ? analyzeSource(file, content) : { functions: [], signals: [], parseErrors: [] };
  });
const functions = analyses.flatMap(analysis => analysis.functions);
const signals = analyses.flatMap(analysis => analysis.signals);
const counts: Record<string, { files: number; lines: number }> = {};
for (const file of files) {
  const count = counts[file.category] ?? { files: 0, lines: 0 };
  count.files += 1;
  count.lines += file.lines;
  counts[file.category] = count;
}
console.log(
  JSON.stringify(
    {
      version: 1,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      scope: { excludedPatterns: EXCLUDED_PATTERNS.map(String), excluded, counts },
      files,
      functions,
      signals,
      parseErrors: analyses.flatMap(analysis => analysis.parseErrors),
    },
    null,
    2
  )
);
