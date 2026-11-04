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
        async execute(context) {
          observation.execute(id, context);
          let result: BackendPluginCliResult;
          try { result = await plan.execute.call(plan, context); }
          catch (error) { observation.threw(id, 'execute'); throw error; }
          observation.result(id, 'execute', result);
          return result;
        },
      } };
    },
  } };
}
