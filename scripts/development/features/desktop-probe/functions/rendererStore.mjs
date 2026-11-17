/**
 * Renderer 里取 Pinia store 的表达式，只给探针夹具和验收场景造条件。
 * 调用方只用 store 自己的 action，不直接改字段；产品代码不依赖这里。
 */
export function rendererStore(id) {
  const missing = JSON.stringify(`Renderer 没有 Pinia store：${id}`);
  return `(document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get(${JSON.stringify(id)})
    ?? (() => { throw new Error(${missing}); })())`;
}
