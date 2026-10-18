import { describe, expect, it } from 'vitest';
import { breadcrumbsOf, buildTree, childrenOf, flattenTree, orderNodes } from './tree.ts';

/** The playground's pages collection, as IDs and titles. */
const pages = [
  ['index', 'Vesper playground'],
  ['about', 'About the college'],
  ['academics', 'Academics'],
  ['academics/business', 'Business'],
  ['academics/business/accounting', 'Accounting'],
  ['academics/general-studies', 'General studies'],
  ['academics/nursing', 'Nursing'],
  ['academics/nursing/clinical-placements', 'Clinical placements'],
  ['academics/nursing/clinical-placements/partner-hospitals', 'Partner hospitals'],
  ['academics/nursing/rn-to-bsn', 'RN to BSN bridge'],
  ['admissions/apply', 'How to apply'],
  ['admissions/tuition', 'Tuition and fees'],
  ['campus-life', 'Campus life'],
].map(([id, title]) => ({
  id: id ?? '',
  title: title ?? '',
  url: id === 'index' ? '/' : `/${id ?? ''}/`,
}));

const orders = {
  '': ['about', 'academics', 'admissions', 'campus-life'],
  academics: ['nursing', 'business', 'general-studies'],
  'academics/nursing': ['clinical-placements', 'rn-to-bsn'],
};

const outline = (nodes: ReturnType<typeof buildTree>): string[] =>
  flattenTree(nodes).map((n) => `${'  '.repeat(Math.max(0, n.depth - 1))}${n.slug || '(root)'}`);

describe('buildTree', () => {
  it('nests by folder and orders by _order.yaml, the root page first', () => {
    expect(outline(buildTree(pages, orders))).toEqual([
      '(root)',
      'about',
      'academics',
      '  nursing',
      '    clinical-placements',
      '      partner-hospitals',
      '    rn-to-bsn',
      '  business',
      '    accounting',
      '  general-studies',
      'admissions',
      '  apply',
      '  tuition',
      'campus-life',
    ]);
  });

  it('keeps a folder with no section page as a node without an entry or URL', () => {
    const admissions = buildTree(pages, orders).find((n) => n.slug === 'admissions');
    expect(admissions).toMatchObject({ title: 'Admissions', url: null, depth: 1 });
    expect(admissions?.id).toBeUndefined();
  });

  it('sorts unlisted children by title after the listed ones', () => {
    const tree = buildTree(pages, { '': ['campus-life'] });
    expect(tree.map((n) => n.title)).toEqual([
      'Vesper playground',
      'Campus life',
      'About the college',
      'Academics',
      'Admissions',
    ]);
  });

  it('ignores order entries that name no child, and sorts numbers naturally', () => {
    const nodes = ['Step 10', 'Step 2', 'Step 1'].map((title, i) => ({
      path: `s${String(i)}`,
      slug: `s${String(i)}`,
      title,
      url: null,
      depth: 1,
      children: [],
    }));
    expect(orderNodes(nodes, ['gone']).map((n) => n.title)).toEqual([
      'Step 1',
      'Step 2',
      'Step 10',
    ]);
  });

  it('carries each entry through untouched', () => {
    const entry = { data: { title: 'About' } };
    const [node] = buildTree([{ id: 'about', title: 'About', entry }]);
    expect(node?.entry).toBe(entry);
  });
});

describe('childrenOf and breadcrumbsOf', () => {
  const tree = buildTree(pages, orders);

  it('lists a section’s children in order', () => {
    expect(childrenOf(tree, 'academics/nursing').map((n) => n.slug)).toEqual([
      'clinical-placements',
      'rn-to-bsn',
    ]);
    expect(childrenOf(tree, 'about')).toEqual([]);
    expect(childrenOf(tree, 'index').map((n) => n.slug)).toEqual([
      'about',
      'academics',
      'admissions',
      'campus-life',
    ]);
  });

  it('gives the trail from Home to the page, folders without a page unlinked', () => {
    expect(breadcrumbsOf(tree, 'academics/nursing/clinical-placements/partner-hospitals')).toEqual([
      { title: 'Vesper playground', url: '/', id: 'index' },
      { title: 'Academics', url: '/academics/', id: 'academics' },
      { title: 'Nursing', url: '/academics/nursing/', id: 'academics/nursing' },
      {
        title: 'Clinical placements',
        url: '/academics/nursing/clinical-placements/',
        id: 'academics/nursing/clinical-placements',
      },
      {
        title: 'Partner hospitals',
        url: '/academics/nursing/clinical-placements/partner-hospitals/',
        id: 'academics/nursing/clinical-placements/partner-hospitals',
      },
    ]);
    expect(breadcrumbsOf(tree, 'admissions/apply').map((c) => [c.title, c.url])).toEqual([
      ['Vesper playground', '/'],
      ['Admissions', null],
      ['How to apply', '/admissions/apply/'],
    ]);
    expect(breadcrumbsOf(tree, 'index')).toEqual([
      { title: 'Vesper playground', url: '/', id: 'index' },
    ]);
    expect(breadcrumbsOf(tree, 'missing')).toEqual([]);
  });
});
