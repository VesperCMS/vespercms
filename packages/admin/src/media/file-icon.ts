import type { IconName } from '@vespercms/ui';

const KINDS: [IconName, string[]][] = [
  [
    'file-text',
    ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'mdx', 'mdoc', 'ppt', 'pptx', 'key'],
  ],
  ['file-sheet', ['csv', 'tsv', 'xls', 'xlsx', 'ods', 'numbers']],
  ['file-archive', ['zip', 'gz', 'tgz', 'tar', '7z', 'rar']],
  ['file-video', ['mp4', 'm4v', 'mov', 'webm', 'ogv']],
  ['file-audio', ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'flac', 'aac']],
];

/** The icon for a file that isn't an image, by its extension; a plain page when unknown. */
export function fileIcon(extension: string): IconName {
  return KINDS.find(([, extensions]) => extensions.includes(extension))?.[0] ?? 'file';
}
