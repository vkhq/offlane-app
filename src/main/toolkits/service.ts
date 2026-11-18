// The toolkits as the rest of the app sees them: what is offered for this
// computer, what is installed, and how each install is going, as one
// status per toolkit; and installing, updating and removing them.
//
// No Electron import.
import { EventEmitter } from 'node:events';

import type {
  ToolkitId,
  ToolkitStatus,
  ToolkitVariantOffer,
} from '../../shared/toolkits';
import {
  type ReleaseOverlay,
  type ToolkitDefinition,
  type ToolkitVariant,
  buildCatalog,
} from './catalog';
import { type FeedSource, fetchFeed } from './feed';
import { ToolkitInstaller } from './installer';
import { published } from './published';
import { ToolkitMissingError, type ToolkitStore } from './store';

export type ToolkitsDeps = {
  store: ToolkitStore;
  /** "<os>-<arch>", as in vendor/. */
  target: string;
  /** The signed feed of newer releases, if the app has one. */
  feed?: FeedSource | null;
  /** Releases besides the pinned ones (./published.ts); for tests. */
  overlays?: ReleaseOverlay[];
};

export class Toolkits extends EventEmitter<{ changed: [ToolkitStatus[]] }> {
  readonly store: ToolkitStore;
  private readonly installer: ToolkitInstaller;
  private catalog: ToolkitDefinition[];
  private feedOverlay: ReleaseOverlay | null = null;

  constructor(private readonly deps: ToolkitsDeps) {
    super();
    this.store = deps.store;
    this.installer = new ToolkitInstaller(deps.store);
    this.catalog = this.build();
    this.installer.on('state', () => this.changed());
  }

  private build() {
    // The feed's releases first: they are the newest.
    return buildCatalog([
      ...(this.feedOverlay ? [this.feedOverlay] : []),
      ...(this.deps.overlays ?? [published]),
    ]);
  }

  /** Tells listeners every toolkit's status. */
  changed() {
    this.emit('changed', this.list());
  }

  isInstalled(id: ToolkitId): boolean {
    return this.store.installed(id) !== null;
  }

  /** Throws ToolkitMissingError for the first of `ids` not installed. */
  assertInstalled(ids: readonly ToolkitId[]) {
    const missing = ids.find((id) => !this.isInstalled(id));
    if (missing) throw new ToolkitMissingError(missing);
  }

  list(): ToolkitStatus[] {
    return this.catalog.map((definition) => this.status(definition));
  }

  private offers(definition: ToolkitDefinition): ToolkitVariantOffer[] {
    return definition.variants.flatMap((variant) => {
      const [release] = variant.targets[this.deps.target] ?? [];
      if (!release) return [];
      return [
        {
          id: variant.id,
          name: variant.name,
          note: variant.note,
          version: release.version,
          size: release.archives.reduce((sum, item) => sum + item.size, 0),
          host: release.host,
          ...(variant.license && { license: variant.license }),
          default: variant.default === true,
        },
      ];
    });
  }

  private status(definition: ToolkitDefinition): ToolkitStatus {
    const installed = this.store.installed(definition.id);
    const offers = this.offers(definition);
    const current = installed
      ? offers.find((offer) => offer.id === installed.variant)
      : undefined;
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      contents: definition.contents,
      planned: definition.variants.length === 0,
      installed: installed && {
        variant: installed.variant,
        version: installed.version,
        size: installed.size,
        source: installed.source,
      },
      offers,
      // A development checkout's vendor/ build is never "out of date": it
      // is whatever `npm run fetch-binaries` fetched.
      updateAvailable:
        installed?.source === 'user' &&
        current !== undefined &&
        current.version !== installed.version,
      install: this.installer.state(definition.id),
    };
  }

  private variantOf(id: ToolkitId, variantId?: string): ToolkitVariant {
    const definition = this.catalog.find((item) => item.id === id);
    if (!definition) throw new Error('Unknown toolkit.');
    // With no variant named: the one installed (an update), else the default.
    const wanted =
      variantId ??
      this.store.installed(id)?.variant ??
      definition.variants.find((variant) => variant.default)?.id;
    const variant = definition.variants.find((item) => item.id === wanted);
    if (!variant) throw new Error('This toolkit isn’t offered yet.');
    return variant;
  }

  /** Installs, updates or switches the variant of a toolkit. */
  async install(id: ToolkitId, variantId?: string): Promise<void> {
    const variant = this.variantOf(id, variantId);
    try {
      await this.installer.install(
        id,
        variant.id,
        variant.targets[this.deps.target] ?? [],
      );
    } finally {
      this.changed();
    }
  }

  cancel(id: ToolkitId) {
    this.installer.cancel(id);
  }

  cancelAll() {
    this.installer.cancelAll();
  }

  /** Stops every install as the app quits; the next launch resumes them. */
  suspendAll() {
    this.installer.suspendAll();
  }

  /**
   * Starts again every install the app quit in the middle of, from the
   * beginning, once its leftovers are cleared. One whose toolkit is now
   * installed with that variant, or no longer offered here, is dropped.
   * Call once at startup; progress and errors show in the statuses.
   */
  async resumeInterrupted(): Promise<void> {
    const ids = this.catalog.map((definition) => definition.id);
    for (const { id, variant } of await this.installer.interrupted(ids)) {
      const offered = this.offers(
        this.catalog.find((definition) => definition.id === id)!,
      ).some((offer) => offer.id === variant);
      if (!offered || this.store.installed(id)?.variant === variant) {
        await this.installer.forgetInterrupted(id);
        continue;
      }
      this.install(id, variant).catch((error) =>
        console.error(`[toolkits] resuming ${id} failed:`, error),
      );
    }
  }

  async remove(id: ToolkitId): Promise<void> {
    try {
      await this.installer.remove(id);
    } finally {
      this.changed();
    }
  }

  /** Fetches the signed feed, if there is one, and offers what it lists. */
  async checkForUpdates(signal?: AbortSignal): Promise<void> {
    if (!this.deps.feed) return;
    this.feedOverlay = await fetchFeed(this.deps.feed, signal);
    this.catalog = this.build();
    this.changed();
  }
}
