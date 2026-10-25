import { useState } from 'react';
import { cx } from './shared.tsx';

export type AvatarProps = {
  /** The person's name, for their initials. A GitHub login's `@` is skipped. */
  name: string;
  /** Their picture's address. Without one, or when it fails to load, the initials show. */
  src?: string | undefined;
  size?: 24 | 32;
  className?: string;
};

/** Up to two letters: the first of the name's first two words. */
export function initialsOf(name: string): string {
  const words = name.replace(/^@/, '').trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}

/**
 * A person's picture, round, or their initials on accent-subtle. It always
 * sits beside their name (spec §10.4), so it's hidden from screen readers.
 */
export function Avatar({ name, src, size = 24, className }: AvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const showPicture = src !== undefined && src !== '' && failed !== src;
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-subtle font-semibold text-accent',
        size === 32 ? 'size-8 text-small' : 'size-6 text-caption',
        className,
      )}
    >
      {showPicture ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => {
            setFailed(src);
          }}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
