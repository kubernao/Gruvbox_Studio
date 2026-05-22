/**
 * Defines the abstraction boundary between local Web Speech playback and optional cloud neural
 * synthesis. Local playback stays entirely in the renderer using `speechSynthesis`, while cloud
 * implementations stream or buffer audio from the main-process OpenAI proxy so API keys never ship
 * inside the web bundle.
 */

import type { SpeechTtsProxyResult } from '../../shared/utils/ipc';

export type CloudTtsRequest = {
  text: string;
  voice?: string;
};

export type CloudTtsResult = SpeechTtsProxyResult;

/**
 * Contract for generating audiobook-quality audio via the desktop IPC bridge (OpenAI speech API in main).
 * Implementations may call OpenAI or another vendor on the server while the renderer receives only bytes.
 */
export type CloudTtsClient = {
  synthesizeDocumentAudio: (request: CloudTtsRequest) => Promise<CloudTtsResult>;
};
