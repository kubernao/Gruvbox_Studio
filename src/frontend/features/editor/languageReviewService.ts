import nspell from 'nspell';
import affData from '../../../../assets/dictionary/en.aff?raw';
import dicData from '../../../../assets/dictionary/en.dic?raw';
import writeGood from 'write-good';
import textReadability from 'text-readability';

export type LanguageIssue = {
  term: string;
  index: number;
  message: string;
  suggestions?: string[];
};

export type SpellCheckResult = {
  misspellings: LanguageIssue[];
};

export type GrammarCheckResult = {
  issues: LanguageIssue[];
};

export type ReadabilityCheckResult = {
  words: number;
  score: number;
  grade: number;
};

const WORD_PATTERN = /\b[A-Za-z][A-Za-z'-]+\b/g;
let checker: ReturnType<typeof nspell> | null = null;

function createDictionaryBytes(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

function getSpellChecker(): ReturnType<typeof nspell> {
  if (checker) {
    return checker;
  }
  checker = nspell({
    aff: createDictionaryBytes(affData),
    dic: createDictionaryBytes(dicData),
  });
  return checker;
}

function isLikelyUrl(word: string): boolean {
  return word.includes('://') || word.includes('.') || word.startsWith('@');
}

export async function runSpellCheck(text: string): Promise<SpellCheckResult> {
  const spell = getSpellChecker();
  const misspellings: LanguageIssue[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const word = match[0];
    const index = match.index ?? 0;
    if (isLikelyUrl(word)) {
      continue;
    }
    if (!spell.correct(word)) {
      misspellings.push({
        term: word,
        index,
        message: `"${word}" is not in the active dictionary`,
        suggestions: spell.suggest(word).slice(0, 4),
      });
    }
  }
  return { misspellings };
}

export async function runGrammarCheck(text: string): Promise<GrammarCheckResult> {
  const issues = writeGood(text, {
    weasel: true,
    passive: true,
    tooWordy: true,
    cliches: true,
    thereIs: true,
    so: true,
    adverb: true,
  }).map((issue) => ({
    term: issue.reason || 'grammar issue',
    index: issue.index,
    message: issue.reason,
    suggestions: issue.suggestion ? [issue.suggestion] : undefined,
  }));
  return { issues };
}

export async function runReadabilityCheck(text: string): Promise<ReadabilityCheckResult> {
  const words = textReadability.lexiconCount(text, true);
  return {
    words,
    score: Number(textReadability.fleschReadingEase(text).toFixed(1)),
    grade: Number(textReadability.textStandard(text, true).toFixed(1)),
  };
}
