import type { AppServerRpcPeer } from '../../../../app-server-rpc';
import type {
  DesktopTextMeasurementWorkerPort,
  TextMeasurementWorkerAvailability,
} from '../../../definitions/backendTextMeasurementRuntimeDependencies';
import type { DesktopCapabilityMailboxRpcClientPort } from '../../../shared/mailbox-rpc/definitions/desktopCapabilityMailboxRpc';
import {
  MeasurementBatchRequestSchema,
  MeasurementBatchResponseSchema,
  PROTOCOL_VERSION,
} from '../../../../../../features/text-measurement/infrastructure/browser-pretext/protocol';
import {
  DESKTOP_TEXT_MEASUREMENT_BATCH_MAILBOX_CHANNEL,
  DESKTOP_TEXT_MEASUREMENT_BATCH_RPC_METHOD,
  DESKTOP_TEXT_MEASUREMENT_CLUSTER_BATCH_MAILBOX_CHANNEL,
  DESKTOP_TEXT_MEASUREMENT_CLUSTER_BATCH_RPC_METHOD,
  DESKTOP_TEXT_MEASUREMENT_TOUCH_RPC_METHOD,
} from '../definitions/textMeasurementWorkerRpc';

export function createDesktopTextMeasurementWorkerRpcClient(input: {
  readonly rpc: Pick<AppServerRpcPeer, 'request'>;
  readonly mailbox: DesktopCapabilityMailboxRpcClientPort;
  readonly availability: TextMeasurementWorkerAvailability;
  readonly onAsyncFailure: (error: Error) => void;
}): DesktopTextMeasurementWorkerPort {
  const port: DesktopTextMeasurementWorkerPort = {
    availability: Object.freeze(input.availability),
    async measureBatch(inputs) {
      const request = MeasurementBatchRequestSchema.parse({
        requestId: 'desktop-text-measurement-batch',
        protocolVersion: PROTOCOL_VERSION,
        inputs,
      });
      return MeasurementBatchResponseSchema.parse(await input.mailbox.invoke(
        DESKTOP_TEXT_MEASUREMENT_BATCH_RPC_METHOD,
        DESKTOP_TEXT_MEASUREMENT_BATCH_MAILBOX_CHANNEL,
        [request.inputs],
      ));
    },
    async measureClusterAdvancesBatch(requests) {
      const request = MeasurementBatchRequestSchema.parse({
        requestId: 'desktop-text-measurement-cluster-batch',
        protocolVersion: PROTOCOL_VERSION,
        inputs: [],
        clusterRequests: requests,
      });
      return MeasurementBatchResponseSchema.parse(await input.mailbox.invoke(
        DESKTOP_TEXT_MEASUREMENT_CLUSTER_BATCH_RPC_METHOD,
        DESKTOP_TEXT_MEASUREMENT_CLUSTER_BATCH_MAILBOX_CHANNEL,
        [request.clusterRequests ?? []],
      ));
    },
    touch() {
      void input.rpc.request(DESKTOP_TEXT_MEASUREMENT_TOUCH_RPC_METHOD, null)
        .then(value => {
          if (value !== null) throw new Error('Text measurement touch response 不合法');
        })
        .catch((error: unknown) => input.onAsyncFailure(toError(error)));
    },
  };
  return Object.freeze(port);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
