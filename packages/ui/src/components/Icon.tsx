/*
 * The studio's icons are Lucide's (https://lucide.dev, ISC licence), drawn by
 * one component at the design system's weight (DECISIONS.md, "Icons are
 * Lucide's"). Only the icons named here are bundled.
 */
import { createElement } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRightLeft,
  ArrowUp,
  Bold,
  Check,
  ChevronDown,
  CircleAlert,
  Code,
  Copy,
  Ellipsis,
  ExternalLink,
  File,
  FileArchive,
  FileMusic,
  FilePlay,
  FilePlus,
  FileSpreadsheet,
  FileText,
  FileUp,
  FolderInput,
  FolderTree,
  GripVertical,
  Heading2,
  Heading3,
  Image,
  ImageUp,
  Images,
  Italic,
  Link,
  List,
  ListOrdered,
  PanelLeft,
  Pencil,
  Plus,
  Quote,
  Search,
  SlidersHorizontal,
  SquarePen,
  Trash,
  TriangleAlert,
  Upload,
  X,
} from 'lucide';
import { cx } from './shared.tsx';

/** One drawing: Lucide's `[tag, attributes][]` on a 24-unit grid. */
export type IconNode = readonly (readonly [string, Readonly<Record<string, unknown>>])[];

export const ICONS = {
  // The four that may stand alone (spec §10.4), plus the formatting tools.
  close: X,
  more: Ellipsis,
  drag: GripVertical,
  chevron: ChevronDown,
  check: Check,
  bold: Bold,
  italic: Italic,
  heading: Heading2,
  subheading: Heading3,
  bullets: List,
  numbers: ListOrdered,
  quote: Quote,
  code: Code,
  link: Link,
  image: Image,
  // Beside words.
  add: Plus,
  upload: Upload,
  import: FileUp,
  'replace-image': ImageUp,
  back: ArrowLeft,
  'move-up': ArrowUp,
  'move-down': ArrowDown,
  'move-to': FolderInput,
  duplicate: Copy,
  'list-pane': PanelLeft,
  details: SlidersHorizontal,
  'view-on-site': ExternalLink,
  open: SquarePen,
  edit: Pencil,
  'add-child': FilePlus,
  delete: Trash,
  warning: TriangleAlert,
  error: CircleAlert,
  search: Search,
  media: Images,
  redirects: ArrowRightLeft,
  // Collections without an icon of their own, and file types.
  collection: FileText,
  tree: FolderTree,
  singleton: SlidersHorizontal,
  'file-text': FileText,
  'file-sheet': FileSpreadsheet,
  'file-archive': FileArchive,
  'file-video': FilePlay,
  'file-audio': FileMusic,
  file: File,
} as const satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

/*
 * A manifest can carry an icon a site named (a collection's), so only
 * Lucide's shapes and their geometry are drawn: nothing else from the data
 * reaches the page.
 */
const SHAPES = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
const GEOMETRY = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'width',
  'height',
  'points',
]);

export type IconProps = {
  /** One of the studio's icons… */
  name?: IconName;
  /** …or a drawing, such as a collection's icon from the manifest. */
  node?: IconNode;
  /** Width and height in pixels; 20 by default. */
  size?: number;
  className?: string;
};

/**
 * An icon, always decorative: the words beside it, or its control's
 * accessible name, say what it means. The stroke is 1.75px at every size,
 * as the design system draws icons.
 */
export function Icon({ name, node, size = 20, className }: IconProps) {
  const drawing: IconNode = node ?? (name ? ICONS[name] : []);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={(1.75 * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cx('shrink-0', className)}
    >
      {drawing.map(([tag, attributes], index) =>
        SHAPES.has(tag)
          ? createElement(tag, {
              // A drawing never changes order, so its index is a stable key.
              key: index,
              ...Object.fromEntries(
                Object.entries(attributes).filter(
                  ([key, value]) =>
                    GEOMETRY.has(key) && (typeof value === 'string' || typeof value === 'number'),
                ),
              ),
            })
          : null,
      )}
    </svg>
  );
}
