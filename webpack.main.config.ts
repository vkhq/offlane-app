import path from 'node:path';

import { requestAppRestart } from '@electron-forge/core-utils/restart';
import type { Compiler, Configuration } from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

/**
 * In `npm start`, restarts the app once the main process is rebuilt for a
 * change to it, as the page updates once it is: Forge watches main but
 * only restarts it on `rs`. A build with errors leaves the running app as
 * it is. The first build is the one the app starts with, and a packaged
 * build has only that one.
 *
 * The type checker makes main rebuild for any file in the project, so a
 * rebuild restarts the app only when one of main's own files changed;
 * otherwise each edit to the page would close the window and open it
 * again. tsconfig.json excludes .webpack too, or Forge's output landing
 * there at startup would count as an edit.
 */
class RestartOnRebuild {
  apply(compiler: Compiler) {
    /** The files main is built from, as of its last build. */
    let built: Set<string> | undefined;
    compiler.hooks.done.tap('RestartOnRebuild', (stats) => {
      const before = built;
      built = new Set(
        [...stats.compilation.modules].flatMap((module) =>
          'resource' in module && typeof module.resource === 'string'
            ? [module.resource]
            : [],
        ),
      );
      if (!before || stats.hasErrors()) return;
      // The type checker adds every file in tsconfig.json to main's watch,
      // so an edit to the page rebuilds main too; restart only for a file
      // main is built from (or was, for one deleted).
      const touched = [
        ...(compiler.modifiedFiles ?? []),
        ...(compiler.removedFiles ?? []),
      ];
      if (touched.some((file) => built?.has(file) || before.has(file))) {
        requestAppRestart();
      }
    });
  }
}

export const mainConfig: Configuration = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/main/index.ts',
  // Put your normal webpack config below here
  module: {
    rules: [
      ...rules,
      // Tool manifests, reduced to the toolkits each tool requires (see the
      // loader); main never sees their icons or anything React.
      {
        test: /[/\\]src[/\\]tools[/\\][^/\\]+[/\\][^/\\]+[/\\]manifest\.ts$/,
        enforce: 'pre',
        // Relative to the project, where Forge runs.
        use: path.resolve('scripts/webpack/manifest-requires-loader.cjs'),
      },
    ],
  },
  plugins: [...plugins, new RestartOnRebuild()],
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
};
