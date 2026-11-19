// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Offlane's name and addresses, in one place. The build (forge.config.mts),
 * the main process and Settings › About read them from here.
 *
 * Forks: the Offlane name and logo are not covered by the GPL (see
 * REUSE.toml). Change these values and replace assets/brand/ with your own.
 *
 * The update and toolkit feed addresses are used only by official builds
 * (see `officialBuild`); read them through `brandServers`.
 */
export const brand = {
  productName: 'Offlane',
  /**
   * The macOS bundle id. macOS ties permissions, preferences and saved
   * passwords to it, so it must never change once a version is released.
   */
  appBundleId: 'app.offlane.desktop',
  website: 'https://www.offlane.app',
  supportEmail: 'offlaneapp@gmail.com',
  sourceCode: 'https://github.com/vkhq/offlane-app',
  trademarkPolicy:
    'https://github.com/vkhq/offlane-app/blob/main/TRADEMARKS.md',
  /** Where app updates come from. None until auto-update is built. */
  updateFeedUrl: null as string | null,
  /**
   * The signed toolkit feed (see main/toolkits/feed.ts). None until one is
   * published.
   */
  toolkitFeedUrl: null as string | null,
} as const;

/**
 * Whether this is an official Offlane build: one made by the release
 * workflow, which sets OFFLANE_OFFICIAL_BUILD=1. Any other build, including
 * `npm start`, `npm run package` and every fork, is unofficial: it says so
 * in its title and About, and never contacts Offlane's update or toolkit
 * servers. Fixed when the app is built (webpack replaces the constant), so
 * setting the variable when running the app changes nothing. Outside
 * webpack (the integration tests) it is false.
 */
export const officialBuild =
  typeof __OFFLANE_OFFICIAL_BUILD__ !== 'undefined' &&
  __OFFLANE_OFFICIAL_BUILD__;

/** The name shown in the window title and About. */
export const displayName = officialBuild
  ? brand.productName
  : `${brand.productName} (unofficial build)`;

/** Offlane's own servers, for official builds only; none otherwise. */
export const brandServers = {
  updateFeedUrl: officialBuild ? brand.updateFeedUrl : null,
  toolkitFeedUrl: officialBuild ? brand.toolkitFeedUrl : null,
};
