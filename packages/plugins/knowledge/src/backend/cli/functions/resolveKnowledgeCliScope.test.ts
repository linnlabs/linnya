import { describe, expect, it } from 'vitest';
import type { KnowledgeCliCommand } from '../definitions/knowledgeCliCommand';
import { KnowledgeCliPermissionError } from '../definitions/knowledgeCliErrors';
import { parseKnowledgeCli } from './parseKnowledgeCli';
import { assertKnowledgeCliAccess, resolveKnowledgeCliScope } from './resolveKnowledgeCliScope';

function command(argv: readonly string[]): KnowledgeCliCommand {
  const parsed = parseKnowledgeCli(argv);
  if (parsed.kind !== 'command') throw new Error('expected a CLI operation');
  return parsed.command;
}

describe('knowledge CLI project access', () => {
  it('rejects an unbound conversation even for metadata reads', () => {
    for (const projectId of [undefined, '', ' ']) {
      expect(() => resolveKnowledgeCliScope(projectId, [])).toThrow(KnowledgeCliPermissionError);
    }
  });

  it('keeps implicit default readable but never grants write or unlink access', () => {
    const scope = resolveKnowledgeCliScope('project-a', []);
    expect(scope.kbIds).toEqual(['default']);
    for (const argv of [['list'], ['documents', 'list', '--kb', 'default'], ['index', 'status', '--kb', 'default']]) {
      expect(() => assertKnowledgeCliAccess(scope, command(argv))).not.toThrow();
    }
    for (const argv of [
      ['documents', 'import', '--kb', 'default', '--source', 'conversation:/a.md'],
      ['documents', 'delete', '--kb', 'default', '--document', 'doc-a'],
      ['index', 'rebuild', '--kb', 'default'],
      ['unlink', '--kb', 'default'],
    ]) {
      expect(() => assertKnowledgeCliAccess(scope, command(argv)), argv.join(' ')).toThrow(KnowledgeCliPermissionError);
    }
  });

  it('limits every targeted operation to the current project links', () => {
    const scope = resolveKnowledgeCliScope('project-a', [{ kbId: 'kb-a', role: 'read_write' }]);
    expect(scope.kbIds).toEqual(['kb-a']);
    for (const kbId of ['default', 'kb-b']) {
      for (const argv of [
        ['documents', 'list', '--kb', kbId],
        ['documents', 'import', '--kb', kbId, '--source', 'conversation:/a.md'],
        ['documents', 'delete', '--kb', kbId, '--document', 'doc-b'],
        ['index', 'status', '--kb', kbId],
        ['index', 'rebuild', '--kb', kbId],
        ['unlink', '--kb', kbId],
      ]) {
        expect(() => assertKnowledgeCliAccess(scope, command(argv)), argv.join(' ')).toThrow(KnowledgeCliPermissionError);
      }
    }
  });

  it('allows a read-only association to be read and unlinked without allowing content changes', () => {
    const scope = resolveKnowledgeCliScope('project-a', [{ kbId: 'kb-a', role: 'read_only' }]);
    for (const argv of [['documents', 'list', '--kb', 'kb-a'], ['index', 'status', '--kb', 'kb-a'], ['unlink', '--kb', 'kb-a']]) {
      expect(() => assertKnowledgeCliAccess(scope, command(argv))).not.toThrow();
    }
    for (const argv of [
      ['documents', 'import', '--kb', 'kb-a', '--source', 'conversation:/a.md'],
      ['documents', 'delete', '--kb', 'kb-a', '--document', 'doc-a'],
      ['index', 'rebuild', '--kb', 'kb-a'],
    ]) {
      expect(() => assertKnowledgeCliAccess(scope, command(argv))).toThrow(KnowledgeCliPermissionError);
    }
  });

  it('allows content mutations only for explicit read-write associations, including default', () => {
    for (const kbId of ['kb-a', 'default']) {
      const scope = resolveKnowledgeCliScope('project-a', [{ kbId, role: 'read_write' }]);
      for (const argv of [
        ['documents', 'import', '--kb', kbId, '--source', 'conversation:/a.md'],
        ['documents', 'delete', '--kb', kbId, '--document', 'doc-a'],
        ['index', 'rebuild', '--kb', kbId],
        ['unlink', '--kb', kbId],
      ]) {
        expect(() => assertKnowledgeCliAccess(scope, command(argv))).not.toThrow();
      }
    }
  });

  it('captures association facts without sharing a mutable caller array', () => {
    const links = [{ kbId: 'kb-a', role: 'read_only' as const }];
    const scope = resolveKnowledgeCliScope('project-a', links);
    links[0].kbId = 'kb-b';
    expect(scope.kbIds).toEqual(['kb-a']);
    expect(() => assertKnowledgeCliAccess(scope, command(['unlink', '--kb', 'kb-a']))).not.toThrow();
    expect(() => assertKnowledgeCliAccess(scope, command(['unlink', '--kb', 'kb-b']))).toThrow(KnowledgeCliPermissionError);
  });
});
