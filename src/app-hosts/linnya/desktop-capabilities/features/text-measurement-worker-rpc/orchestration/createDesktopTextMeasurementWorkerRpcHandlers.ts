import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../../app-server-rpc';
import type { DesktopTextMeasurementWorkerPort } from '../../../definitions/backendTextMeasurementRuntimeDependencies';
import { createDesktopCapabilityMailboxRpcHandler } from '../../../shared/mailbox-rpc/orchestration/createDesktopCapabilityMailboxRpcHandler';
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

export function createDesktopTextMeasurementWorkerRpcHandlers(input: {
  readonly port: DesktopTextMeasurementWorkerPort;
  readonly mailboxRoot: string;
}): AppServerRpcHandlerRegistry {
  const measureBatch = createDesktopCapabilityMailboxRpcHandler({
    mailboxRoot: input.mailboxRoot,
    channel: DESKTOP_TEXT_MEASUREMENT_BATCH_MAILBOX_CHANNEL,
    invoke: async args => {
      const values = readSingleArg(args, 'Text measurement batch');
      const request = MeasurementBatchRequestSchema.parse({
        requestId: 'desktop-text-measurement-batch',
        protocolVersion: PROTOCOL_VERSION,
        inputs: values,
      });
      return MeasurementBatchResponseSchema.parse(
        await input.port.measureBatch(request.inputs),
      );
    },
  });
  const measureClusterBatch = createDesktopCapabilityMailboxRpcHandler({
    mailboxRoot: input.mailboxRoot,
    channel: DESKTOP_TEXT_MEASUREMENT_CLUSTER_BATCH_MAILBOX_CHANNEL,
    invoke: async args => {
      if (!input.port.measureClusterAdvancesBatch) {
        throw new Error('Desktop text measurement worker 不支持 cluster advance');
      }
      const values = readSingleArg(args, 'Text measurement cluster batch');
      const request = MeasurementBatchRequestSchema.parse({
        requestId: 'desktop-text-measurement-cluster-batch',
        protocolVersion: PROTOCOL_VERSION,
        inputs: [],
        clusterRequests: values,
      });
      return MeasurementBatchResponseSchema.parse(
        await input.port.measureClusterAdvancesBatch(request.clusterRequests ?? []),
      );
    },
  });
  return new Map<string, AppServerRpcHandler>([
    [DESKTOP_TEXT_MEASUREMENT_BATCH_RPC_METHOD, measureBatch],
    [DESKTOP_TEXT_MEASUREMENT_CLUSTER_BATCH_RPC_METHOD, measureClusterBatch],
    [DESKTOP_TEXT_MEASUREMENT_TOUCH_RPC_METHOD, payload => {
      if (payload !== null) throw new Error('Text measurement touch payload 不合法');
      input.port.touch();
      return null;
    }],
  ]);
}

function readSingleArg(args: readonly unknown[], label: string): unknown {
  if (args.length !== 1) throw new Error(`${label} 参数数量不合法`);
  return args[0];
}
