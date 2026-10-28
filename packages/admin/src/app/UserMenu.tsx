import { Avatar, Button, Menu, type MenuItem } from '@vespercms/ui';
import { useEffect, useState } from 'react';
import type { StudioApi } from './api.ts';
import { APPEARANCES, useAppearance, type Appearance } from './appearance.ts';
import { useStudio } from './context.tsx';

const localNames = new WeakMap<StudioApi, Promise<string | null>>();

/** Local mode's editor, from git on this computer; asked once per visit. */
function useLocalName(api: StudioApi | undefined): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (!api?.person) return;
    let asked = localNames.get(api);
    if (!asked) {
      asked = api.person().then(
        (person) => person.name,
        () => null,
      );
      localNames.set(api, asked);
    }
    let live = true;
    void asked.then((found) => {
      if (live) setName(found);
    });
    return () => {
      live = false;
    };
  }, [api]);
  return name;
}

/**
 * The user menu at the end of the top bar (spec §10.3): who is signed in and
 * the way out in GitHub mode and the cloud (spec §6.9), and Appearance in
 * every mode, local mode included, named by git's user there (DECISIONS.md,
 * "Appearance is in the user menu, and local mode has a user menu").
 */
export function UserMenu() {
  const { account, api } = useStudio();
  const [appearance, choose] = useAppearance();
  const localName = useLocalName(account ? undefined : api);

  if (account?.expired) {
    return (
      <Button variant="quiet" onPress={account.signInAgain}>
        Sign in again
      </Button>
    );
  }

  const name = account?.name ?? localName ?? 'You';
  const items: MenuItem[] = account
    ? [
        ...(account.dashboardUrl ? [{ id: 'dashboard', label: 'Open dashboard' }] : []),
        { id: 'sign-out', label: account.signOutLabel },
      ]
    : [];

  return (
    <Menu
      label={
        account ? account.description : localName ? `Appearance, for ${localName}` : 'Appearance'
      }
      triggerText={account?.label ?? name}
      triggerPicture={<Avatar name={name} src={account?.picture} />}
      header={
        <div className="flex items-center gap-3">
          <Avatar name={name} src={account?.picture} size={32} />
          <div className="min-w-0">
            <p className="truncate text-label text-content">{name}</p>
            <p className="truncate text-small text-content-muted">
              {account ? account.description : 'Editing on this computer'}
            </p>
          </div>
        </div>
      }
      choice={{
        title: 'Appearance',
        options: [...APPEARANCES],
        selected: appearance,
        onChange: (id) => {
          choose(id as Appearance);
        },
      }}
      items={items}
      onAction={(id) => {
        if (id === 'dashboard' && account?.dashboardUrl) {
          window.open(account.dashboardUrl, '_blank', 'noopener');
        }
        if (id === 'sign-out') account?.signOut();
      }}
    />
  );
}
