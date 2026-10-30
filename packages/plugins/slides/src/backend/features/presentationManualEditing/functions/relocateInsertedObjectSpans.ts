import type { DeckSpec, FreeformElement, StructuredElement } from '@plugin/slides/shared';
import { getSlidesTypeScriptRuntime } from '../../../capabilities/typescriptRuntime/index.js';
import { readInsertedObjectLocations } from '../../../sandbox/layoutTrace/index.js';

/**
 * 人工值改写只改变 compose.manualEdits literal 内的行，插入对象的源码定位随之移动；
 * 按新源码重读这些位置，快照投影即可与重新编译得到相同的定位，其余 AI 对象不受影响。
 */
export function relocateInsertedObjectSpans(deckSpec: DeckSpec, source: string): DeckSpec {
  const typescript = getSlidesTypeScriptRuntime();
  const file = typescript.createSourceFile('deck.js', source, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.JS);
  let locations: ReturnType<typeof readInsertedObjectLocations> = {};
  typescript.forEachChild(file, function visit(node): void {
    if (typescript.isCallExpression(node) && typescript.isIdentifier(node.expression) && node.expression.text === 'compose' && node.arguments[0]) {
      locations = readInsertedObjectLocations(typescript, file, node.arguments[0]);
    }
    typescript.forEachChild(node, visit);
  });
  function relocate<T extends FreeformElement | StructuredElement>(element: T): T {
    const ref = element._authoringRef;
    const span = ref ? locations[ref.slideKey]?.[ref.editKey] : undefined;
    return span ? { ...element, _sourceSpan: span } : element;
  }
  return { ...deckSpec, slides: deckSpec.slides.map(slide => ({ ...slide, spec: slide.spec.type === 'structured'
    ? { ...slide.spec, elements: slide.spec.elements.map(relocate) }
    : { ...slide.spec, elements: slide.spec.elements.map(relocate) } })) };
}
