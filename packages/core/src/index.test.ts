import { describe, expect, it } from 'vitest';
import * as relative from './index.ts';
import * as viaPackage from '@vespercms/core';

describe('@vespercms/core entry point', () => {
  it('resolves the package specifier to this source file, not dist/', () => {
    // CI runs tests without building, so this only passes when Vitest honours
    // the @vesper/source condition. Same module instance means same file.
    expect(viaPackage).toBe(relative);
  });

  it('exports the manifest format version', () => {
    expect(relative.MANIFEST_VERSION).toBe(1);
  });
});
