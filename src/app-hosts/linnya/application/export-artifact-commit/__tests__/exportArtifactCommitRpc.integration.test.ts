import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppServerRpcPeer } from '../../../app-server-rpc';
import { createDesktopCapabilityMailboxRpcClient } from '../../../desktop-capabilities';
import { createExportArtifactCommitRpcClient } from '../orchestration/createExportArtifactCommitRpcClient';
import { createExportArtifactCommitRpcHandlers } from '../orchestration/createExportArtifactCommitRpcHandlers';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('Export artifact commit RPC', () => {
  it('通过 mailbox 提交大型二进制且 RPC 不暴露真实文件路径', async () => {
    const mailboxRoot = await mkdtemp(path.join(os.tmpdir(), 'linnya-export-commit-rpc-'));
    temporaryRoots.push(mailboxRoot);
    const commit = vi.fn(async () => ({ fileName: 'deck.pptx', byteLength: 2_000_000 }));
    const pair = createPeerPair({ mailboxRoot, commit });
    const client = createExportArtifactCommitRpcClient(
      createDesktopCapabilityMailboxRpcClient({
        rpc: pair.backend,
        mailboxRoot,
      }),
    );
    const bytes = new Uint8Array(2_000_000).fill(7);

    await expect(client.commit({
      pluginId: 'slides',
      targetToken: 'opaque-target-token',
      extension: 'pptx',
      mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      bytes,
    })).resolves.toEqual({ fileName: 'deck.pptx', byteLength: bytes.byteLength });
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'slides',
      targetToken: 'opaque-target-token',
      bytes,
    }));

    pair.dispose();
  }, 30_000);
});

function createPeerPair(input: {
  readonly mailboxRoot: string;
  readonly commit: (request: {
    readonly pluginId: string;
    readonly targetToken: string;
    readonly extension: string;
    readonly mediaType: string;
    readonly bytes: Uint8Array;
  }) => Promise<{ readonly fileName: string; readonly byteLength: number }>;
}) {
  const desktopToBackend = new PassThrough();
  const backendToDesktop = new PassThrough();
  const desktop = createAppServerRpcPeer({
    input: backendToDesktop,
    output: desktopToBackend,
    handlers: createExportArtifactCommitRpcHandlers({
      mailboxRoot: input.mailboxRoot,
      port: { commit: input.commit },
    }),
  });
  const backend = createAppServerRpcPeer({
    input: desktopToBackend,
    output: backendToDesktop,
    handlers: new Map(),
  });
  return {
    backend,
    dispose() {
      desktop.dispose();
      backend.dispose();
      desktopToBackend.destroy();
      backendToDesktop.destroy();
    },
  };
}
