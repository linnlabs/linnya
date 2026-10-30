import { beforeEach, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSlidesStore } from '../features/documentRuntime';
import { useSlidesRenderStore } from './slidesRenderStore';
import { makePresentationView } from '../../shared/presentationViewSnapshot/testing/viewFixture';
beforeEach(() => setActivePinia(createPinia()));
it('projects the installed snapshot and clears with the document without another model request', () => {
  const slides = useSlidesStore(); const render = useSlidesRenderStore(); slides.beginDocument('deck');
  const view = makePresentationView(); slides.installSnapshot(view, 1);
  expect(render.renderModel).toBe(view.renderModel); expect(render.currentSlideRender?.index).toBe(1);
  slides.beginDocument('other'); expect(render.renderModel).toBeNull(); expect(render.renderLoading).toBe(true);
  slides.$reset(); expect(render.renderLoading).toBe(false);
});
