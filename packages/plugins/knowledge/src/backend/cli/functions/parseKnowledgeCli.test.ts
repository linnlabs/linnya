import { describe, expect, it } from 'vitest';
import { KnowledgeCliUsageError } from '../definitions/knowledgeCliErrors';
import { KNOWLEDGE_CLI_HELP, parseKnowledgeCli } from './parseKnowledgeCli';

describe('knowledge CLI arguments', () => {
  it('preserves the source file argument and resolves the supported operations', () => {
    expect(parseKnowledgeCli(['list'])).toEqual({ kind: 'command', command: { action: 'list' } });
    expect(parseKnowledgeCli(['documents', 'list', '--kb=kb-a'])).toEqual({
      kind: 'command', command: { action: 'documents.list', kbId: 'kb-a' },
    });
    expect(parseKnowledgeCli(['documents', 'import', '--source', 'conversation:/资料/报告 final.md', '--kb', 'kb-a'])).toEqual({
      kind: 'command', command: { action: 'documents.import', kbId: 'kb-a', source: 'conversation:/资料/报告 final.md' },
    });
    expect(parseKnowledgeCli(['documents', 'delete', '--kb', 'kb-a', '--document', 'doc-b'])).toEqual({
      kind: 'command', command: { action: 'documents.delete', kbId: 'kb-a', documentId: 'doc-b' },
    });
    for (const operation of ['status', 'rebuild']) {
      expect(parseKnowledgeCli(['index', operation, '--kb', 'kb-a'])).toEqual({
        kind: 'command', command: { action: `index.${operation}`, kbId: 'kb-a' },
      });
    }
    expect(parseKnowledgeCli(['unlink', '--kb', 'kb-a'])).toEqual({
      kind: 'command', command: { action: 'unlink', kbId: 'kb-a' },
    });
  });

  it('returns help without requiring a project or operation arguments', () => {
    for (const argv of [[], ['help'], ['-h'], ['--help'], ['documents', 'import', '--help']]) {
      expect(parseKnowledgeCli(argv)).toEqual({ kind: 'help' });
    }
  });

  it('rejects ambiguous targets, incomplete commands and unsupported mutation/model flags', () => {
    const invalid = [
      ['documents', 'list'],
      ['documents', 'list', '--kb', ''],
      ['documents', 'list', '--kb', '   '],
      ['documents', 'list', '--kb', 'kb-a', '--kb=kb-b'],
      ['documents', 'delete', '--kb', 'kb-a'],
      ['documents', 'import', '--kb', 'kb-a'],
      ['documents', 'import', '--kb', 'kb-a', '--source', 'conversation:/a.md', '--model', 'x'],
      ['documents', 'list', '--kb', 'kb-a', '--document', 'doc-a'],
      ['list', '--kb', 'kb-a'],
      ['list', 'kb-a'],
      ['unlink', '--kb', 'kb-a', '--project', 'other-project'],
      ['create', '--name', 'new'],
      ['search', '--kb', 'kb-a'],
      ['delete', '--kb', 'kb-a'],
      ['link', '--kb', 'kb-a'],
      ['help', 'unexpected'],
    ];
    for (const argv of invalid) {
      expect(() => parseKnowledgeCli(argv), argv.join(' ')).toThrow(KnowledgeCliUsageError);
    }
    try {
      parseKnowledgeCli(['documents', 'delete', '--kb', 'kb-a']);
      throw new Error('expected usage failure');
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeCliUsageError);
      if (!(error instanceof KnowledgeCliUsageError)) throw error;
      expect(error.exitCode).toBe(2);
      expect(error.message).toContain(KNOWLEDGE_CLI_HELP);
    }
  });

  it('uses the formal conversation locator rules before any file can be read', () => {
    for (const source of [
      'workspace:/report.md', 'file:///tmp/report.md', '/tmp/report.md', 'C:\\report.md',
      'conversation:/', 'conversation:/../report.md', 'conversation:/a/./b.md',
      'conversation:/a//b.md', 'conversation:/a\\b.md', 'conversation:/a.md#part',
    ]) {
      expect(() => parseKnowledgeCli(['documents', 'import', '--kb', 'kb-a', '--source', source]), source)
        .toThrow(KnowledgeCliUsageError);
    }
  });
});
