/** tsup多配置各自拥有构建图；首次声明生成全部完成，才能放行Desktop消费者。 */
export async function watchTsupConfigurations({ configuration, build, afterBuild, ready }) {
  const configurations = Array.isArray(configuration) ? configuration : [configuration];
  let initialBuildCompleted = false, finalization = Promise.resolve();
  const finalize = () => {
    // 多个入口同时重编时串行运行发布脚本，失败不永久毒化下一次有效构建。
    finalization = finalization.then(afterBuild, afterBuild);
    return finalization.then(ready);
  };
  await Promise.all(configurations.map(configuration => build({
    ...configuration,
    config: false,
    watch: true,
    ignoreWatch: ['**/_dev_data/**', '**/_dev_electron/**', '**/target/**', 'dist/**', 'packages/plugins/*/dist/**'],
    async onSuccess() {
      await configuration.onSuccess?.();
      if (initialBuildCompleted) await finalize();
    },
  })));
  await finalize(); initialBuildCompleted = true;
}
