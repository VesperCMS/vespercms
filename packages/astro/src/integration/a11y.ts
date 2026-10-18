import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import vm from 'node:vm';
import {
  BUILD_RULES,
  BUILD_RULE_IDS,
  ContentService,
  PageService,
  urlKey,
  type StaticRoutes,
  type UrlSettings,
} from '@vesper/core';
import type { SiteModel } from '../node/manifest.ts';
import { LocalStorage } from '../node/storage-local.ts';

/*
 * Accessibility checks at build (spec §6.18, layer 2). Every built page is
 * loaded into jsdom with no browser, axe-core runs only the structure rules
 * (no colour or layout), and each page is traced back to the entry that
 * produced it. The report goes to `.vesper/a11y-report.json` in the
 * project, never into `dist/`, so it's never deployed.
 *
 * jsdom was measured against Chromium on the playground's build: the same
 * violations on every page (DECISIONS.md, "The build checks with axe-core
 * in jsdom"). It never runs the page's own scripts ('outside-only').
 */

export type A11yBuildOptions = {
  /** Fail the build on an issue at this level or above. Off by default. */
  failBuildOn?: 'error' | 'warning' | false;
};

export type A11yIssue = {
  /** axe-core's rule ID. */
  rule: string;
  /** `error` for axe's critical and serious impacts, `warning` for moderate and minor. */
  level: 'error' | 'warning';
  message: string;
  why: string;
  /** axe-core's own explanation of the rule. */
  help: string;
  /** A CSS selector for the element. */
  target: string;
  /** The element's opening HTML, shortened. */
  html: string;
};

export type A11yPageEntry = {
  collection: string;
  id: string;
  /** The entry's file, site-relative. */
  file: string;
  /** Where the entry opens in the studio ("fix in studio"). */
  studio: string;
};

export type A11yPage = {
  url: string;
  /** The HTML file, relative to `dist/`. */
  file: string;
  /** The entry that produced the page, or null for pages no entry produced (listings, 404). */
  entry: A11yPageEntry | null;
  issues: A11yIssue[];
};

export type A11yReport = {
  version: 1;
  generator: string;
  note: string;
  checked: {
    pages: number;
    /** Astro's redirect pages and the studio's shell, which aren't the site's content. */
    skipped: { redirects: number; studio: number };
    engine: string;
    rules: string[];
  };
  summary: { errors: number; warnings: number; pages: number };
  /** Pages with issues, in URL order. */
  pages: A11yPage[];
};

export const REPORT_PATH = '.vesper/a11y-report.json';

/** One built HTML file: its path in `dist/` and the URL it's served at. */
export type BuiltPage = { file: string; url: string };

/** Every HTML file in `dist/`, with its URL (`base` included), skipping Astro's assets and Vesper's files. */
export function builtPages(dist: string, base: string): BuiltPage[] {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const files = readdirSync(dist, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split(sep).join('/'))
    .filter((file) => file.endsWith('.html') && !/^(?:_astro|_vesper)\//.test(file))
    .sort();
  return files.map((file) => ({ file, url: prefix + urlPathOf(file) }));
}

/** `blog/welcome/index.html` → `blog/welcome/`, `about.html` → `about`, `index.html` → ``. */
export function urlPathOf(file: string): string {
  if (file === 'index.html') return '';
  if (file.endsWith('/index.html')) return file.slice(0, -'index.html'.length);
  return file.slice(0, -'.html'.length);
}

/** Astro's static redirect pages (a meta refresh), and the studio's own shell. */
export function skipReason(file: string, html: string): 'redirect' | 'studio' | null {
  if (/<meta\s+http-equiv=["']?refresh/i.test(html)) return 'redirect';
  if (file === 'admin/index.html' || file === 'admin.html') return 'studio';
  return null;
}

type AxeNode = { target: unknown[]; html: string };
type AxeViolation = { id: string; impact?: string | null; helpUrl: string; nodes: AxeNode[] };
/** What axe-core adds to a page's window once its script has run there. */
type AxeRunner = {
  run: (context: unknown, options: object) => Promise<{ violations: AxeViolation[] }>;
};

/** Runs the build rules over one page's HTML. */
type PageChecker = (html: string, url: string) => Promise<AxeViolation[]>;

async function pageChecker(): Promise<{ check: PageChecker; engine: string }> {
  const require = createRequire(import.meta.url);
  const { JSDOM, VirtualConsole } = await import('jsdom');
  const axePath = require.resolve('axe-core/axe.min.js');
  const axeVersion = (
    JSON.parse(readFileSync(join(axePath, '..', 'package.json'), 'utf8')) as { version: string }
  ).version;
  const jsdomVersion = (
    JSON.parse(readFileSync(require.resolve('jsdom/package.json'), 'utf8')) as { version: string }
  ).version;
  // Compiled once, run in each page's own context.
  const axe = new vm.Script(readFileSync(axePath, 'utf8'), { filename: 'axe.min.js' });
  return {
    engine: `axe-core ${axeVersion} in jsdom ${jsdomVersion}`,
    check: async (html, url) => {
      const dom = new JSDOM(html, {
        url,
        runScripts: 'outside-only',
        virtualConsole: new VirtualConsole(),
      });
      const window = dom.window as typeof dom.window & { axe: AxeRunner };
      // jsdom has no layout. The page-level rules (one main landmark, one h1)
      // call these, and without them axe reports an error instead of a result.
      window.document.elementFromPoint = () => null;
      window.document.elementsFromPoint = () => [];
      try {
        axe.runInContext(dom.getInternalVMContext());
        const result = await window.axe.run(window.document, {
          runOnly: { type: 'rule', values: [...BUILD_RULE_IDS] },
          resultTypes: ['violations'],
        });
        return result.violations;
      } finally {
        window.close();
      }
    },
  };
}

/** The issues axe found, in the studio's words. */
export function issuesOf(violations: readonly AxeViolation[]): A11yIssue[] {
  return violations.flatMap((violation) => {
    const rule = BUILD_RULES[violation.id];
    const level =
      violation.impact === 'critical' || violation.impact === 'serious' ? 'error' : 'warning';
    return violation.nodes.map((node) => ({
      rule: violation.id,
      level,
      message: rule?.message ?? violation.id,
      why: rule?.why ?? '',
      help: violation.helpUrl.replace(/\?application=.*$/, ''),
      target: node.target.map(String).join(' '),
      html: node.html.length > 200 ? `${node.html.slice(0, 199)}…` : node.html,
    }));
  });
}

/** Each entry's page by URL key, with what the report says about it. */
async function entriesByKey(
  root: string,
  model: SiteModel,
  routes: () => StaticRoutes,
  base: string,
): Promise<Map<string, A11yPageEntry>> {
  const storage = new LocalStorage(root);
  const content = new ContentService(storage, model.manifest);
  const pages = new PageService(storage, model.manifest, content, {
    routes,
    ...(model.urlFunctions ? { urlFunctions: model.urlFunctions } : {}),
  });
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const map = new Map<string, A11yPageEntry>();
  for (const page of await pages.pageEntries()) {
    map.set(page.key, {
      collection: page.collection,
      id: page.id,
      file: page.path,
      studio: `${prefix}admin/#/c/${encodeURIComponent(page.collection)}/e/${encodeURIComponent(page.id)}`,
    });
  }
  return map;
}

export type CheckBuildResult = {
  report: A11yReport;
  written: string | null;
  failed: string | null;
};

/**
 * Checks every built page and writes the report. Returns why the build
 * should fail under `failBuildOn`, or null.
 */
export async function checkBuild(options: {
  root: string;
  dist: string;
  model: SiteModel;
  settings: UrlSettings;
  routes: () => StaticRoutes;
  a11y: A11yBuildOptions;
}): Promise<CheckBuildResult> {
  const { root, dist, model, settings } = options;
  const entries = await entriesByKey(root, model, options.routes, settings.base);
  const { check, engine } = await pageChecker();
  const skipped = { redirects: 0, studio: 0 };
  const pages: A11yPage[] = [];
  let checked = 0;
  for (const page of builtPages(dist, settings.base)) {
    const html = readFileSync(join(dist, page.file), 'utf8');
    const skip = skipReason(page.file, html);
    if (skip === 'redirect') skipped.redirects++;
    if (skip === 'studio') skipped.studio++;
    if (skip) continue;
    checked++;
    const issues = issuesOf(await check(html, `http://localhost${page.url}`));
    if (issues.length === 0) continue;
    const key = urlKey(page.url, settings);
    pages.push({
      url: page.url,
      file: page.file,
      entry: (key === null ? undefined : entries.get(key)) ?? null,
      issues,
    });
  }
  const all = pages.flatMap((p) => p.issues);
  const report: A11yReport = {
    version: 1,
    generator: '@vesper/astro',
    note: 'Automated checks find some problems, not all. Colour contrast and other visual checks need a rendered page, and nothing replaces testing with a keyboard and a screen reader.',
    checked: { pages: checked, skipped, engine, rules: [...BUILD_RULE_IDS] },
    summary: {
      errors: all.filter((i) => i.level === 'error').length,
      warnings: all.filter((i) => i.level === 'warning').length,
      pages: pages.length,
    },
    pages,
  };
  const written = writeReport(root, dist, report);
  const { failBuildOn = false } = options.a11y;
  const failing =
    failBuildOn === 'error'
      ? report.summary.errors
      : failBuildOn === 'warning'
        ? report.summary.errors + report.summary.warnings
        : 0;
  return {
    report,
    written,
    failed:
      failing > 0
        ? `Accessibility: ${String(failing)} ${failBuildOn === 'error' ? 'errors' : 'issues'} at build, and vesper({ a11y: { failBuildOn: '${String(failBuildOn)}' } }) fails the build on them. See ${REPORT_PATH}.`
        : null,
  };
}

/**
 * Writes the report to `.vesper/` in the project, with a `.gitignore` so it
 * never reaches git by accident. Never into `dist/`: when the output folder
 * would contain it, nothing is written. Returns the path, or null.
 */
export function writeReport(root: string, dist: string, report: A11yReport): string | null {
  const folder = resolve(root, '.vesper');
  const out = resolve(dist);
  if (folder === out || folder.startsWith(out + sep)) return null;
  mkdirSync(folder, { recursive: true });
  const ignore = join(folder, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '# Written by Vesper at build. Not for git.\n*\n');
  const path = join(folder, 'a11y-report.json');
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return relative(root, path).split(sep).join('/');
}

/** One line for the build log. */
export function summaryLine(result: CheckBuildResult): string {
  const { report, written } = result;
  const { errors, warnings, pages } = report.summary;
  const found =
    errors + warnings === 0
      ? 'no issues'
      : `${String(errors + warnings)} ${errors + warnings === 1 ? 'issue' : 'issues'} on ${String(pages)} ${pages === 1 ? 'page' : 'pages'} (${String(errors)} ${errors === 1 ? 'error' : 'errors'})`;
  const where = written
    ? `Report: ${written}`
    : 'No report written: the output folder contains .vesper/.';
  const checked = report.checked.pages;
  return `Accessibility: checked ${String(checked)} ${checked === 1 ? 'page' : 'pages'}, ${found}. ${where}`;
}
