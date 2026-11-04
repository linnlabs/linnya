import type { PluginBackendContribution } from '@plugin/backend/pluginContribution';
import type { BackendPluginCliPreparation, BackendPluginCliResult } from '@plugin/backend/pluginCli';
import type { CanvasCliObservation } from './definitions';

/** 开发验收外壳只装饰公开CLI；不重新创建插件，也不接管任何运行态生命周期。 */
export function observeCanvasPluginCli(original: PluginBackendContribution, observation: CanvasCliObservation): PluginBackendContribution {
  const cli = original.pluginCli;
  if (!cli) return original;
  return { ...original, pluginCli: {
    prepare(input) {
      const id = observation.start(input);
      let preparation: BackendPluginCliPreparation;
      try { preparation = cli.prepare.call(cli, input); }
      catch (error) { observation.threw(id, 'prepare'); throw error; }
      if (preparation.status === 'completed') {
        observation.result(id, 'prepare', preparation.result);
        return preparation;
      }
      const plan = preparation.plan;
      observation.ready(id);
      return { ...preparation, plan: { ...plan,
        execute(context) {
          observation.execute(id, context);
          let execution: Promise<BackendPluginCliResult>;
          try { execution = plan.execute.call(plan, context); }
          catch (error) { observation.threw(id, 'execute'); throw error; }
          // 回调先于Host随后安装的await收口，但返回原Promise，不新增业务Promise身份。
          void execution.then(result => observation.result(id, 'execute', result), () => observation.threw(id, 'execute'));
          return execution;
        },
      } };
    },
  } };
}
