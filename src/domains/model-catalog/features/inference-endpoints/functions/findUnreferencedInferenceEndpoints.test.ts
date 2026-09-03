import { describe, expect, it } from 'vitest';

import type { ModelConfig } from '../../../definitions/modelCatalog';
import type { InferenceEndpoint } from '../../../definitions/inferenceEndpoint';
import { findUnreferencedInferenceEndpoints } from './findUnreferencedInferenceEndpoints';

function model(id: string, endpointId: string): ModelConfig {
  return {
    id,
    model_name: id,
    catalog_source: 'user',
    inference_endpoint_id: endpointId,
    capabilities: ['chat'],
    ui_visibility: [],
    display_name: id,
    description: 'user model',
  };
}

function endpoint(id: string): InferenceEndpoint {
  return {
    id,
    route_profile_id: 'openai_compatible_chat',
    endpoint_id: `openai-compatible:${id}`,
    base_url: 'https://models.example.com/v1',
    auth_profile: 'bearer',
    credential_reference: {
      kind: 'stored_secret',
      credential_id: `inference-endpoint:${id}`,
    },
  };
}

describe('find unreferenced inference endpoints', () => {
  it('共享 endpoint 仍有模型引用时保留，最后一个引用删除后释放', () => {
    const sharedEndpoint = endpoint('shared');

    expect(
      findUnreferencedInferenceEndpoints(
        [model('remaining-model', sharedEndpoint.id)],
        [sharedEndpoint]
      )
    ).toEqual([]);
    expect(findUnreferencedInferenceEndpoints([], [sharedEndpoint])).toEqual([sharedEndpoint]);
  });
});
