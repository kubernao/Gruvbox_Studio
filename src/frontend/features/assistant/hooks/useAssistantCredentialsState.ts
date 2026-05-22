import { useEffect, useState } from 'react';
import { IPCService, type CredentialsStatusPayload } from '../../../shared/utils/ipc';

export const initialCredentialsStatus: CredentialsStatusPayload = {
  openRouter: { configured: false },
  openAi: { configured: false },
};

/**
 * useAssistantCredentialsState tracks whether OpenRouter and OpenAI keys are configured locally.
 */
export function useAssistantCredentialsState() {
  const [credentialsStatus, setCredentialsStatus] = useState<CredentialsStatusPayload>(initialCredentialsStatus);

  useEffect(() => {
    let active = true;
    void IPCService.getCredentialsStatus()
      .then((status) => {
        if (active) {
          setCredentialsStatus(status);
        }
      })
      .catch(() => {
        // Keep default on bootstrap failures.
      });
    const unsubscribe = IPCService.onCredentialsChanged((next) => {
      if (active) {
        setCredentialsStatus(next);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const saveOpenRouterKey = async (secret: string): Promise<{ ok: boolean; error?: string }> => {
    const result = await IPCService.setCredentials('openrouter', secret);
    if (result.ok) {
      setCredentialsStatus({
        openRouter: result.openRouter ?? { configured: true },
        openAi: result.openAi ?? credentialsStatus.openAi,
      });
    }
    return result;
  };

  const saveOpenAiKey = async (secret: string): Promise<{ ok: boolean; error?: string }> => {
    const result = await IPCService.setCredentials('openai', secret);
    if (result.ok) {
      setCredentialsStatus({
        openRouter: result.openRouter ?? credentialsStatus.openRouter,
        openAi: result.openAi ?? { configured: true },
      });
    }
    return result;
  };

  const clearOpenRouterKey = async (): Promise<void> => {
    await IPCService.clearCredentials('openrouter');
  };

  const clearOpenAiKey = async (): Promise<void> => {
    await IPCService.clearCredentials('openai');
  };

  return {
    credentialsStatus,
    saveOpenRouterKey,
    saveOpenAiKey,
    clearOpenRouterKey,
    clearOpenAiKey,
  };
}
