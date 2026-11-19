/** Set by webpack from OFFLANE_OFFICIAL_BUILD (see shared/brand.ts). */
declare const __OFFLANE_OFFICIAL_BUILD__: boolean;

// Webpack's require.context, which finds the tool folders (see
// src/renderer/tools/index.ts and src/main/tools/registry.ts).

interface WebpackContext {
  keys(): string[];
  <T = unknown>(key: string): T;
}

declare namespace NodeJS {
  interface Require {
    context(
      directory: string,
      recursive: boolean,
      filter: RegExp,
      mode?: 'sync' | 'lazy' | 'eager',
    ): WebpackContext;
  }
}
