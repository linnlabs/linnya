import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';
import type { ModelConfig } from '../../../definitions/modelCatalog';
import { prepareInferenceEndpointSelection } from '../../inference-endpoints';
import { planCustomApiGroupMutation } from '../functions/planCustomApiGroupMutation';
import type {
  CustomApiGroupMutation,
  CustomApiGroupState,
} from '../definitions/customApiGroupMutation';

/** 凭据准备与纯目录计划按序执行；任何准备失败都先撤销凭据，再交还 Catalog 事务。 */
export async function prepareCustomApiGroupMutation(
  mutation: CustomApiGroupMutation,
  state: CustomApiGroupState,
  bindModel: (model: ModelConfig, endpoint: InferenceEndpoint) => ModelConfig
) {
  const endpoints = new Map(state.endpoints);
  const rollbacks: Array<() => Promise<void>> = [];
  const rollback = async () => {
    for (const undo of [...rollbacks].reverse()) await undo();
  };
  const selections =
    mutation.kind === 'register'
      ? mutation.registrations.map(item => item.endpoint)
      : mutation.kind === 'rebind'
        ? [mutation.endpoint]
        : [];
  try {
    for (const selection of selections) {
      const prepared = await prepareInferenceEndpointSelection(selection, endpoints);
      rollbacks.push(prepared.rollback);
    }
    return {
      ...planCustomApiGroupMutation(mutation, { ...state, endpoints }, bindModel),
      rollback,
    };
  } catch (error: unknown) {
    await rollback();
    throw error;
  }
}
