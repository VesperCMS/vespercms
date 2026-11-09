import type { A11yRuleId } from './rules.ts';

/** Where a note points: a field in the entry, or a place in its body. */
export type A11yTarget =
  | {
      kind: 'field';
      /** Value path from the entry root, with concrete array indexes: `['hero', 'alt']`. */
      path: (string | number)[];
    }
  | {
      kind: 'body';
      /** Offsets into the body text, around what the note is about. */
      start: number;
      end: number;
      /** 1-based line in the body, for the source view. */
      line: number;
    };

/** One accessibility note (spec §6.18): a plain message, why it matters, and where. */
export type A11yNote = {
  rule: A11yRuleId;
  message: string;
  why: string;
  target: A11yTarget;
  /** What it's about, in words, when the place alone doesn't say: `Image “IMG_2041.jpg”`. */
  subject?: string;
};

/** A background the site declares (spec §6.18): text colours are checked against each. */
export type A11yBackground = { name: string; color: string };

/** The site's accessibility settings, from vesper.config.ts `a11y` (spec §6.18). */
export type A11ySettings = {
  /** Rules whose notes refuse a save (the publish gate). Warn only when empty. */
  blockPublishOn?: A11yRuleId[];
  backgrounds?: A11yBackground[];
};

