declare module 'nspell' {
  type Dictionary = { aff: Uint8Array; dic: Uint8Array };
  type SpellChecker = {
    correct(word: string): boolean;
    suggest(word: string): string[];
  };
  export default function nspell(dictionary: Dictionary): SpellChecker;
}

declare module 'write-good' {
  type Suggestion = {
    index: number;
    offset: number;
    reason: string;
    suggestion?: string;
  };
  type WriteGoodOptions = {
    weasel?: boolean;
    passive?: boolean;
    tooWordy?: boolean;
    cliches?: boolean;
    thereIs?: boolean;
    so?: boolean;
    adverb?: boolean;
  };
  export default function writeGood(text: string, options?: WriteGoodOptions): Suggestion[];
}

declare module 'text-readability' {
  const readability: {
    lexiconCount(text: string, removePunctuation?: boolean): number;
    fleschReadingEase(text: string): number;
    textStandard(text: string, floatOutput?: boolean): number;
  };
  export default readability;
}
