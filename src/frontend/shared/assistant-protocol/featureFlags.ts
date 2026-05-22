export function isAiDiffFlowV2Enabled(): boolean {
  try {
    const env =
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as { process?: { env?: Record<string, string | undefined> } }).process === 'object'
        ? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
        : undefined;
    return env?.AI_DIFF_FLOW_V2 !== '0';
  } catch {
    return true;
  }
}
