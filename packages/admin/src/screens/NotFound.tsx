import { Link } from '@vesper/ui';
import { hrefFor } from '../app/router.ts';
import { Screen } from '../app/Screen.tsx';

export function NotFound({
  message = 'This page doesn’t exist in the studio.',
}: {
  message?: string;
}) {
  return (
    <Screen title="Not found" afterglow>
      <p className="mb-4 max-w-2xl">{message}</p>

      <Link icon="back" href={hrefFor({ screen: 'home' })}>
        Back to content
      </Link>
    </Screen>
  );
}
