import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

rules.push({
  test: /\.css$/,
  use: [
    { loader: 'style-loader' },
    { loader: 'css-loader' },
    { loader: 'postcss-loader' },
  ],
});

// Images are copied to the output and imported as their local URL.
rules.push({
  test: /\.(png|jpe?g|webp|gif)$/,
  type: 'asset/resource',
});

// Font files referenced from CSS (the bundled Inter font) are copied too.
rules.push({
  test: /\.(woff2?|ttf|otf)$/,
  type: 'asset/resource',
});

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  plugins,
  // From the root, not relative to the page: the page is also served at its
  // routes' paths, where relative URLs would point elsewhere.
  output: { publicPath: '/' },
  // Source maps in their own files, in development too: Forge's default
  // there wraps each module in eval, which the page's policy forbids.
  devtool: 'source-map',
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
  },
};
