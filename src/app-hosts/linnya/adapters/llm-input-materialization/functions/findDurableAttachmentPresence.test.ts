import { describe, expect, it } from 'vitest';
import { findDurableAttachmentPresence } from './findDurableAttachmentPresence';

describe('findDurableAttachmentPresence', () => {
  it('只识别 durable ref，不把 verified resolved attachment 误判为未物化输入', () => {
    const durable = [
      {
        role: 'user',
        content: '',
        attachments: [
          {
            id: 'attachment-1',
            kind: 'image',
            resourceId: 'asset-1',
            mediaType: 'image/png',
            byteLength: 3,
            width: 1,
            height: 1,
            sha256: 'a'.repeat(64),
          },
        ],
      },
    ];
    const resolved = [
      {
        role: 'user',
        content: '',
        attachments: [
          {
            id: 'attachment-1',
            resourceId: 'asset-1',
            mediaType: 'image/png',
            byteLength: 3,
            width: 1,
            height: 1,
            placement: 'user_image',
            bytes: new Uint8Array([1, 2, 3]),
          },
        ],
      },
    ];

    expect(findDurableAttachmentPresence(durable)).toEqual({
      found: true,
      placements: ['user_image'],
    });
    expect(findDurableAttachmentPresence(resolved)).toEqual({
      found: false,
      placements: [],
    });
  });
});
