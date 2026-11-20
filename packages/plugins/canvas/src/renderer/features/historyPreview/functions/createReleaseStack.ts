/** 资源按创建顺序登记，释放时后进先出；重复释放无副作用。 */
export function createReleaseStack() {
  const releases: Array<() => void> = [];
  return {
    add(release: () => void) {
      releases.push(release);
    },
    release() {
      for (const free of releases.splice(0).reverse()) free();
    },
  };
}
