import React from 'react';
import './AiStreamingLoader.css';

/**
 * AiStreamingLoader renders a compact three-dot loader in the Gruvie assistant
 * transcript while the model has not yet produced answer text or a thinking block.
 * It gives users immediate feedback during the pre-token wait without duplicating
 * tool-card or composer activity labels.
 */
export const AiStreamingLoader: React.FC = () => (
  <div
    className="ai-chat-streaming-loader"
    data-testid="ai-streaming-loader"
    role="status"
    aria-live="polite"
    aria-label="Gruvie is thinking"
  >
    <div className="ai-thinking-loader" aria-hidden="true" />
    <span className="ai-thinking-loader__label">Thinking…</span>
  </div>
);

export default AiStreamingLoader;
