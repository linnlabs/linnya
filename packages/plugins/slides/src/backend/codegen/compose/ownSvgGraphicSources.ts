import type { PresentationSvgGraphicOwnerPort } from '../../features/presentationSvgGraphicOwnership';
import type { SvgGraphicOwnershipContext } from '../../features/presentationSvgGraphicOwnership';
import type { DirectComposeInput, DirectElementInput } from './presentationComposeInput';

/** 作者来源只存在于编译中间态；接管完成后才允许构造 canonical DeckSpec。 */
export async function ownSvgGraphicSources(
  input: DirectComposeInput,
  owner: PresentationSvgGraphicOwnerPort,
  context: SvgGraphicOwnershipContext,
): Promise<DirectComposeInput> {
  return {
    ...input,
    slides: await Promise.all(input.slides.map(async (slide) => ({
      ...slide,
      elements: await Promise.all(slide.elements.map(
        element => ownElementSource(element, owner, context),
      )),
    }))),
  };
}

async function ownElementSource(
  element: DirectElementInput,
  owner: PresentationSvgGraphicOwnerPort,
  context: SvgGraphicOwnershipContext,
): Promise<DirectElementInput> {
  if (element.type !== 'svgGraphic') return element;
  if (!element.svgSource) {
    throw new Error('SVG Graphic authoring input is missing its source.');
  }
  return {
    ...element,
    svgAsset: await owner.ownSource(element.svgSource, context),
  };
}

export function directComposeInputHasSvgGraphic(input: DirectComposeInput): boolean {
  return input.slides.some(slide => slide.elements.some(
    element => element.type === 'svgGraphic',
  ));
}
