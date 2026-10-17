export type SerializationErrorCode =
  /** The file can only be edited as raw text (see `SourceOnlyReason`). */
  | 'source-only'
  /** A save produced text that doesn't read back as the intended value. Nothing was written. */
  | 'verification-failed'
  /** The edit isn't possible on this file (for example, a path that doesn't exist). */
  | 'unsupported';

/**
 * Thrown instead of writing anything when a save can't be done exactly. The
 * editor shows the message and keeps the user's edits; the file is untouched.
 */
export class SerializationError extends Error {
  readonly code: SerializationErrorCode;

  constructor(code: SerializationErrorCode, message: string) {
    super(message);
    this.name = 'SerializationError';
    this.code = code;
  }
}
