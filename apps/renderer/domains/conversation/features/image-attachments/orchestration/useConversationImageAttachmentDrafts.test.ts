import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import { useConversationImageAttachmentDrafts } from './useConversationImageAttachmentDrafts';

vi.mock('@/shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({
    onScopeWillChange: vi.fn(() => () => undefined),
  }),
}));

describe('useConversationImageAttachmentDrafts', () => {
  it('composer 临时 unmount/remount 复用 feature owner，不丢同 workspace 草稿', () => {
    setActivePinia(createPinia());
    const firstMount = useConversationImageAttachmentDrafts();
    firstMount.store.appendUploading({
      clientId: 'client-remount',
      fileName: 'remount.png',
      byteLength: 4,
      previewUrl: 'blob:remount',
      status: 'uploading',
    });

    const secondMount = useConversationImageAttachmentDrafts();

    expect(secondMount.controller).toBe(firstMount.controller);
    expect(secondMount.store).toBe(firstMount.store);
    expect(secondMount.store.items).toEqual([
      expect.objectContaining({ clientId: 'client-remount', status: 'uploading' }),
    ]);
  });
});
