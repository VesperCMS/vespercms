import { parseFrontmatter } from '@astrojs/internal-helpers/frontmatter';
import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '../src/files/frontmatter.ts';
import { decodeUtf8 } from '../src/files/text.ts';
import { readYaml } from '../src/files/yaml/read.ts';
import { corpusFiles, fixtureFiles, type CorpusFile } from './helpers/corpus.ts';

type YamlBlock = { file: CorpusFile; text: string; raw: string; kind: 'data' | 'frontmatter' };

function yamlBlocks(files: CorpusFile[]): YamlBlock[] {
  return files.flatMap((file): YamlBlock[] => {
    const text = decodeUtf8(file.bytes);
    if (text === null) return [];
    if (/\.ya?ml$/.test(file.name)) return [{ file, text, raw: text, kind: 'data' }];
    if (!/\.(md|mdx|mdoc)$/.test(file.name)) return [];
    const split = splitFrontmatter(text);
    return split.format === 'yaml' ? [{ file, text, raw: split.raw, kind: 'frontmatter' }] : [];
  });
}

describe('YAML reading over the real-world corpus', () => {
  const blocks = yamlBlocks(corpusFiles());

  it('can edit every block in the committed corpus structurally', () => {
    const sourceOnly = blocks
      .filter((b) => b.file.source === 'corpus')
      .map((b) => ({ name: b.file.name, read: readYaml(b.raw, b.kind === 'data' ? 'any' : 'map') }))
      .filter((r) => !r.read.editable)
      .map((r) => r.name);
    expect(sourceOnly).toEqual([]);
  });

  for (const block of blocks.filter((b) => b.kind === 'frontmatter')) {
    it(`${block.file.source}/${block.file.name}: reads the same values as Astro`, () => {
      const read = readYaml(block.raw);
      if (!read.editable) return;
      expect(read.value).toEqual(parseFrontmatter(block.text).frontmatter);
    });
  }
});

describe('YAML reading over the synthetic fixtures', () => {
  const expectations: Record<string, string> = {
    'frontmatter/duplicate-keys.md': 'yaml-error',
    'frontmatter/invalid-yaml.md': 'yaml-error',
    'frontmatter/parser-disagreement.md': 'yaml-error',
    'frontmatter/tags.md': 'parsers-disagree',
  };

  for (const block of yamlBlocks(fixtureFiles())) {
    const expected = expectations[block.file.name];
    it(`${block.file.name}: ${expected ?? 'editable'}`, () => {
      const read = readYaml(block.raw, block.kind === 'data' ? 'any' : 'map');
      if (expected) expect(read).toMatchObject({ editable: false, reason: expected });
      else expect(read.editable).toBe(true);
    });
  }
});
