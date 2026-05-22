/**
 * Factory that builds a {@link CloudTtsClient} backed by the Electron main-process proxy, keeping the
 * bearer token in the main layer instead of exposing it to untrusted renderer scripts.
 */

import { IPCService } from '../../shared/utils/ipc';
import type { CloudTtsClient, CloudTtsRequest, CloudTtsResult } from './ttsTypes';

/**
 * Returns a client that invokes `speech-tts-provider` in the main process to POST `/v1/speech/tts`.
 */
export function createIpcCloudTtsClient(): CloudTtsClient {
  return {
    async synthesizeDocumentAudio(request: CloudTtsRequest): Promise<CloudTtsResult> {
      return IPCService.speechTtsProxy(request);
    },
  };
}
