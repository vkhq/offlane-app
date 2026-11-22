import path from 'node:path';

import { requestAppRestart } from '@electron-forge/core-utils/restart';
import type { Compiler, Configuration } from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

/**
 * In `npm start`, restarts the app once the main process is rebuilt, as
 * the page reloads once it is: Forge watches main but only restarts it on
 * `rs`. A build with errors leaves the running app as it is. The first
 * build is the one the app starts with, and a packaged build has only
 * that one.
 *
 * Main must then be rebuilt only for a change to it: tsconfig.json
 * excludes .webpack, or the type checker, watching the project folder for
 * the root's *.ts, takes Forge's output landing there at startup for one
 * and the window closes and opens again.
 */
class RestartOnRebuild {
  apply(compiler: Compiler) {
    let first = true;
    compiler.hooks.done.tap('RestartOnRebuild', (stats) => {
      if (first) {
        first = false;
        return;
      }
      if (!stats.hasErrors()) requestAppRestart();
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
