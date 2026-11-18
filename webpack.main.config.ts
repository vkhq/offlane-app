import path from 'node:path';

import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

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
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
};
