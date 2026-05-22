/**
 * Builds chapter-sized segments for OpenAI speech synthesis (4096 chars max per request). Supports
 * markdown-style splits on ATX headings (`#`–`###`) or flat splitting of already-speakable prose.
 */

import {
  extractSpeakableText,
  isMarkdownLikeLanguage,
  markdownToSpeakablePlainText,
} from './extractSpeakableText';
import { normalizeForNarration } from './normalizeForNarration';

/** Single speech request segment (title optional, shown in filenames and manifest). */
export type AudiobookSegment = {
  title?: string;
  text: string;
};

export type AudiobookSplitMode = 'chapters' | 'flat';

export type BuildAudiobookSegmentsInput = {
  rawContent: string;
  language: string;
  splitMode: AudiobookSplitMode;
  /** Max characters per OpenAI `input` (provider limit 4096). */
  maxChars?: number;
};

type MarkdownBlock = {
  title?: string;
  bodyRaw: string;
};

const DEFAULT_MAX = 4096;

/**
 * Splits markdown on top-level ATX headings (lines starting with `#`, `##`, or `###`).
 *
 * @param md - Raw markdown source before global flattening.
 */
export function splitMarkdownByHeadings(md: string): MarkdownBlock[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: { title?: string; lines: string[] }[] = [];
  let current: { title?: string; lines: string[] } = { lines: [] };

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      if (current.lines.length > 0 || current.title !== undefined) {
        blocks.push(current);
      }
      current = { title: heading[2].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  blocks.push(current);

  return blocks.map((block) => ({
    title: block.title,
    bodyRaw: block.lines.join('\n'),
  }));
}

/**
 * Splits one speakable string into parts each at most `maxChars`, preferring paragraph boundaries.
 *
 * @param text - Plain narration text.
 * @param maxChars - Hard maximum segment length.
 */
export function splitOversizedPlainText(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized === '') {
    return [];
  }
  if (normalized.length <= maxChars) {
    return [normalized];
  }
  const parts: string[] = [];
  const paragraphs = normalized.split(/\n\s*\n+/);
  let buffer = '';
  const flush = (): void => {
    const chunk = buffer.trim();
    if (chunk !== '') {
      parts.push(chunk);
    }
    buffer = '';
  };

  for (const paragraph of paragraphs) {
    const piece = paragraph.trim();
    if (piece === '') {
      continue;
    }
    const candidate = buffer === '' ? piece : `${buffer}\n\n${piece}`;
    if (candidate.length > maxChars && buffer !== '') {
      flush();
      buffer = piece;
      while (buffer.length > maxChars) {
        parts.push(buffer.slice(0, maxChars).trim());
        buffer = buffer.slice(maxChars).trimStart();
      }
      continue;
    }
    if (candidate.length > maxChars && buffer === '') {
      let rest = piece;
      while (rest.length > maxChars) {
        parts.push(rest.slice(0, maxChars).trim());
        rest = rest.slice(maxChars).trimStart();
      }
      buffer = rest;
      continue;
    }
    buffer = candidate;
  }
  flush();
  return parts;
}

/**
 * Produces ordered segments for audiobook export from editor buffer metadata.
 *
 * @param input - Raw buffer, language id, and whether to split on markdown headings.
 */
export function buildAudiobookSegments(input: BuildAudiobookSegmentsInput): AudiobookSegment[] {
  const maxChars = input.maxChars ?? DEFAULT_MAX;
  const raw = input.rawContent.replace(/\r\n/g, '\n');
  const md = isMarkdownLikeLanguage(input.language);
  const out: AudiobookSegment[] = [];

  if (md && input.splitMode === 'chapters') {
    const blocks = splitMarkdownByHeadings(raw);
    for (const block of blocks) {
      const flat = normalizeForNarration(markdownToSpeakablePlainText(block.bodyRaw));
      if (flat === '') {
        continue;
      }
      const pieces = splitOversizedPlainText(flat, maxChars);
      for (let i = 0; i < pieces.length; i += 1) {
        const title =
          pieces.length === 1
            ? block.title
            : block.title
              ? `${block.title} (part ${i + 1})`
              : `Part ${i + 1}`;
        out.push({
          title,
          text: pieces[i],
        });
      }
    }
    return out;
  }

  const speakable = normalizeForNarration(
    extractSpeakableText({ content: raw, language: input.language }),
  );
  if (speakable === '') {
    return [];
  }
  const pieces = splitOversizedPlainText(speakable, maxChars);
  pieces.forEach((body, i) => {
    out.push({
      title: pieces.length > 1 ? `Part ${i + 1}` : undefined,
      text: body,
    });
  });
  return out;
}
