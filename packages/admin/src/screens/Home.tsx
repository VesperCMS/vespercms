import type { CollectionManifest, CollectionSummary } from '@vesper/core';
import { InlineStatus, Link } from '@vesper/ui';
import { useStudio } from '../app/context.tsx';
import { formatCount, formatRelative } from '../app/format.ts';
import { useLoad } from '../app/load.ts';
import { hrefFor } from '../app/router.ts';
import { Screen } from '../app/Screen.tsx';

/**
 * The home screen (spec §10.3): a plain list of collections and singletons,
 * with entry counts and when each was last edited. Nothing else.
 */
export function Home() {
  const { manifest, api } = useStudio();
  const [summary] = useLoad(() => api.summary());
  const byName = new Map<string, CollectionSummary>(
    summary.state === 'ready' ? summary.value.map((s) => [s.collection, s]) : [],
  );

  const collections = manifest.collections.filter((c) => !c.presentation.singleton);
  const singletons = manifest.collections.filter((c) => c.presentation.singleton);

  return (
    <Screen title="Content">
      {summary.state === 'failed' && (
        <p className="mb-6 text-danger" role="alert">
          Couldn’t load entry counts: {summary.message}
        </p>
      )}
      {manifest.collections.length === 0 ? (
        <p className="text-content-muted">
          This site has no content collections yet. Add one in <code>src/content.config.ts</code>{' '}
          and it appears here.
        </p>
      ) : (
        <div className="grid max-w-2xl gap-10">
          {collections.length > 0 && (
            <CollectionList
              heading="Collections"
              collections={collections}
              summaries={byName}
              loading={summary.state === 'loading'}
            />
          )}
          {singletons.length > 0 && (
            <CollectionList
              heading="Settings"
              collections={singletons}
              summaries={byName}
              loading={summary.state === 'loading'}
            />
          )}
        </div>
      )}
    </Screen>
  );
}

function CollectionList({
  heading,
  collections,
  summaries,
  loading,
}: {
  heading: string;
  collections: CollectionManifest[];
  summaries: Map<string, CollectionSummary>;
  loading: boolean;
}) {
  return (
    <section aria-labelledby={`home-${heading}`}>
      <h2 id={`home-${heading}`} className="mb-2 text-lg">
        {heading}
      </h2>
      <ul className="divide-y divide-border border-y border-border">
        {collections.map((collection) => (
          <li
            key={collection.name}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3"
          >
            <Link
              href={hrefFor({ screen: 'list', collection: collection.name })}
              className="text-base"
            >
              {collection.label}
            </Link>
            <CollectionFacts
              collection={collection}
              summary={summaries.get(collection.name)}
              loading={loading}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CollectionFacts({
  collection,
  summary,
  loading,
}: {
  collection: CollectionManifest;
  summary: CollectionSummary | undefined;
  loading: boolean;
}) {
  const facts: string[] = [];
  if (!collection.editable) facts.push('Read only');
  if (summary) {
    if (!collection.presentation.singleton)
      facts.push(formatCount(summary.count, 'entry', 'entries'));
    if (summary.updatedAt) facts.push(`edited ${formatRelative(summary.updatedAt)}`);
  } else if (loading) {
    facts.push('Loading…');
  }
  return (
    <InlineStatus live={false} className="text-content-muted">
      {facts.join(' · ')}
    </InlineStatus>
  );
}
