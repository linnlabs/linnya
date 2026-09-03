/**
 * check-layout-dts — CI guard that asserts the on-disk
 * `pptComposeProfile.ambient.d.ts` matches what the generator would
 * produce from the current sources.
 *
 * Run:
 *   npm run codegen-first:dts:check
 *
 * Exits with code 0 when in sync, code 1 otherwise. Programmatic API
 * `runCheck()` returns the same information without invoking process.exit
 * so unit tests can assert behavior directly.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildLayoutDts } from './generate-layout-dts.js';
import { REPO_ROOT } from './layoutDts/outputs.js';

export interface CheckDiff {
  path: string;
  reason: 'missing' | 'mismatch';
  /** First line index where the on-disk content diverges (0-based). */
  firstDiffLine?: number;
  /** Diff preview snippet (max 8 lines around the first divergence). */
  preview?: string;
}

export interface RunCheckResult {
  ok: boolean;
  diffs: CheckDiff[];
}

export function runCheck(): RunCheckResult {
  const { content, outputPaths } = buildLayoutDts();
  const diffs: CheckDiff[] = [];

  for (const absPath of outputPaths) {
    if (!fs.existsSync(absPath)) {
      diffs.push({ path: absPath, reason: 'missing' });
      continue;
    }
    const actual = fs.readFileSync(absPath, 'utf-8');
    if (actual === content) continue;
    diffs.push({
      path: absPath,
      reason: 'mismatch',
      firstDiffLine: firstDiffLine(actual, content),
      preview: diffPreview(actual, content),
    });
  }

  return { ok: diffs.length === 0, diffs };
}

// ─── internal ──────────────────────────────────────────────────────────

function firstDiffLine(a: string, b: string): number {
  const al = a.split('\n');
  const bl = b.split('\n');
  const max = Math.max(al.length, bl.length);
  for (let i = 0; i < max; i++) {
    if (al[i] !== bl[i]) return i;
  }
  return max;
}

function diffPreview(actual: string, expected: string, context = 3): string {
  const al = actual.split('\n');
  const el = expected.split('\n');
  const idx = firstDiffLine(actual, expected);
  const start = Math.max(0, idx - context);
  const end = Math.min(Math.max(al.length, el.length), idx + context + 1);
  const lines: string[] = [];
  for (let i = start; i < end; i++) {
    const aLine = al[i] ?? '<EOF>';
    const eLine = el[i] ?? '<EOF>';
    if (aLine === eLine) {
      lines.push(`  ${i + 1} | ${aLine}`);
    } else {
      lines.push(`- ${i + 1} | ${aLine}`);
      lines.push(`+ ${i + 1} | ${eLine}`);
    }
  }
  return lines.join('\n');
}

// CLI entrypoint
const isCli = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isCli) {
  const r = runCheck();
  if (r.ok) {
    process.stdout.write('[check-layout-dts] OK — generated d.ts matches sources.\n');
    process.exit(0);
  }
  process.stderr.write('[check-layout-dts] FAIL — generated d.ts is out of date.\n');
  for (const d of r.diffs) {
    const rel = path.relative(REPO_ROOT, d.path);
    if (d.reason === 'missing') {
      process.stderr.write(`  - missing: ${rel}\n`);
    } else {
      process.stderr.write(`  - mismatch (line ${(d.firstDiffLine ?? 0) + 1}): ${rel}\n`);
      if (d.preview) process.stderr.write(`${d.preview}\n`);
    }
  }
  process.stderr.write('Hint: run `npm run codegen-first:dts` to regenerate.\n');
  process.exit(1);
}
