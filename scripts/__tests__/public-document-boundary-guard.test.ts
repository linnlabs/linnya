import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { listTrackedPrivateProcessDocuments } from '../guards/public-document-boundary-guard';

describe('public document boundary guard', () => {
  it('拒绝 Git 跟踪 docs/proposals，并允许公开稳定文档', () => {
    const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'linnya-public-doc-guard-'));

    try {
      execFileSync('git', ['init', '--quiet'], { cwd: repositoryRoot });
      mkdirSync(path.join(repositoryRoot, 'docs', 'proposals'), { recursive: true });
      writeFileSync(path.join(repositoryRoot, 'docs', 'architecture.md'), '# Architecture\n');
      writeFileSync(path.join(repositoryRoot, 'docs', 'proposals', 'experiment.md'), '# Experiment\n');
      execFileSync('git', ['add', '-f', 'docs'], { cwd: repositoryRoot });

      expect(listTrackedPrivateProcessDocuments(repositoryRoot)).toEqual([
        'docs/proposals/experiment.md',
      ]);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });
});
