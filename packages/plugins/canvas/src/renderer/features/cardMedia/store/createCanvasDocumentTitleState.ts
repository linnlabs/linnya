import { shallowReadonly, shallowRef } from 'vue';
export function createCanvasDocumentTitleState() {
  const titles = shallowRef<ReadonlyMap<string, string>>(new Map());
  return {
    titles: shallowReadonly(titles),
    install(documentId: string, title: string | null) {
      const next = new Map(titles.value);
      if (title) next.set(documentId, title);
      else next.delete(documentId);
      titles.value = next;
    },
  };
}
