import type { AstroIntegrationLogger } from 'astro';
import { loadSiteModel, type SiteModel } from '../node/manifest.ts';
import type { LoadSiteOptions } from '../node/load-site.ts';

/**
 * The site model, loaded once and shared by the studio page, the dev API and
 * the build. Loading starts the site's Vite in an isolated server, so it
 * happens on first use, not at startup, and again only after a config file
 * changes (`reset`).
 */
export class SiteModelCache {
  private pending: Promise<SiteModel> | null = null;
  private readonly options: LoadSiteOptions;
  private readonly logger: AstroIntegrationLogger;

  constructor(options: LoadSiteOptions, logger: AstroIntegrationLogger) {
    this.options = options;
    this.logger = logger;
  }

  get(): Promise<SiteModel> {
    this.pending ??= loadSiteModel(this.options).then((model) => {
      for (const diagnostic of model.manifest.diagnostics) {
        const where = diagnostic.collection ? `${diagnostic.collection}: ` : '';
        const line = `${where}${diagnostic.message}`;
        if (diagnostic.level === 'error') this.logger.error(line);
        else if (diagnostic.level === 'warning') this.logger.warn(line);
        else this.logger.debug(line);
      }
      return model;
    });
    return this.pending;
  }

  reset(): void {
    this.pending = null;
  }
}
