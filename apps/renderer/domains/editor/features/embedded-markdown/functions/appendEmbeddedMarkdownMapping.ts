import type { Mapping } from '@tiptap/pm/transform';

/** 消费PM公开的map序列，避免不同合法传递版本Mapping私有字段造成名义类型冲突。 */
export function appendEmbeddedMarkdownMapping(target: Mapping, source: Pick<Mapping, 'maps' | 'getMirror'>): void {
  const offset = target.maps.length;
  source.maps.forEach((map, index) => {
    const mirror = source.getMirror(index);
    target.appendMap(map, mirror !== undefined && mirror < index ? offset + mirror : undefined);
  });
}
