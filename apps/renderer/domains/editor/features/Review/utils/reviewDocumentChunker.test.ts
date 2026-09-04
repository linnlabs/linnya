import { describe, expect, it } from 'vitest';
import { withReviewDocumentVersion } from './reviewDocumentChunker';

describe('withReviewDocumentVersion', () => {
  const fragment = [
    '<workspace_document>',
    'document_id: doc-1',
    'doc_type: markdown',
    '---',
    '[#ref] 正文',
    '</workspace_document>',
  ].join('\n');

  it('adds the expected version after document identity', () => {
    expect(withReviewDocumentVersion(fragment, 3)).toContain(
      'document_id: doc-1\ndocument_version: 3\ndoc_type: markdown',
    );
  });

  it('replaces an earlier expected version', () => {
    const versioned = withReviewDocumentVersion(fragment, 3);
    expect(withReviewDocumentVersion(versioned, 4)).toContain('document_version: 4');
    expect(withReviewDocumentVersion(versioned, 4)).not.toContain('document_version: 3');
  });
});
