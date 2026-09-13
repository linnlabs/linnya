import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextEditingTarget } from '../definitions/textEditingTypes';
import { useSlideTextEditingSession } from './useSlideTextEditingSession';

const target: TextEditingTarget = {
  elementId: 'headline',
  authoringRef: { slideKey: 'overview', editKey: 'headline' },
  content: '旧标题',
  origin: { x: 1, y: 1 },
  width: 3,
  height: 1,
  rotation: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  verticalOffset: 0,
  fontFamily: 'sans-serif',
  fontSizePt: 14,
  appliedFontScale: 1,
  fontWeight: 'normal',
  fontStyle: 'normal',
  color: '#000000',
  textAlign: 'left',
  lineHeight: 1.2,
  opacity: 1,
};

describe('useSlideTextEditingSession', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('blocks submission during IME composition and keeps the draft until presentation completes', () => {
    const submitOperation = vi.fn();
    const submitting = ref(false);
    const session = useSlideTextEditingSession({ submitting, submitOperation });
    session.open(target);
    session.draft.value = '新标题';

    session.beginComposition();
    expect(session.requestCommit()).toBe('blocked');
    expect(submitOperation).not.toHaveBeenCalled();

    session.endComposition();
    expect(session.requestCommit()).toBe('submitted');
    expect(submitOperation).toHaveBeenCalledWith({
      op: 'set_text_content',
      target: target.authoringRef,
      content: '新标题',
    });
    expect(session.target.value).toEqual(target);
    expect(session.draft.value).toBe('新标题');

    session.complete();
    expect(session.target.value).toBeNull();
    expect(session.draft.value).toBe('');
  });

  it('closes an unchanged draft without creating a revision', () => {
    const submitOperation = vi.fn();
    const session = useSlideTextEditingSession({ submitting: ref(false), submitOperation });
    session.open(target);

    expect(session.requestCommit()).toBe('closed');
    expect(session.target.value).toBeNull();
    expect(submitOperation).not.toHaveBeenCalled();
  });
});
