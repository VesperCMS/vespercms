import { cx } from './shared.tsx';

export type VesperMarkProps = {
  /** Width and height in pixels. At 24 and below the small cut is drawn. */
  size?: number;
  className?: string;
};

/**
 * Vesper's mark, "Launch" (DECISIONS.md): a rounded V, a long fall and a
 * short rise, with the evening star on the rise's line. Drawn from the tokens,
 * so it follows the theme. Always decorative: it sits beside a visible name
 * that says what it is. White-label (Phase 9) replaces it here.
 */
export function VesperMark({ size = 20, className }: VesperMarkProps) {
  // At small sizes a thin stroke and a haloed star turn to mush: the small cut
  // is heavier, with a bigger star and no halo.
  const small = size <= 24;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cx('shrink-0', className)}
    >
      <path
        d={small ? 'M11 14 L29 50 L42 25' : 'M12 14 L30 50 L43 25'}
        fill="none"
        stroke="currentColor"
        strokeWidth={small ? 11 : 9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {!small && (
        <circle cx="51" cy="12" r="10" className="fill-accent opacity-20 forced-colors:hidden" />
      )}
      <circle
        cx={small ? 52 : 51}
        cy={small ? 11 : 12}
        r={small ? 7 : 5.5}
        className="fill-accent forced-colors:fill-[CanvasText]"
      />
    </svg>
  );
}
