import ReactRefreshPlugin from '@pmmmwh/react-refresh-webpack-plugin';
import ReactRefreshTypeScript from 'react-refresh-typescript';
import type { Configuration, RuleSetRule } from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

const assetRules: RuleSetRule[] = [
  {
    test: /\.css$/,
    use: [
      { loader: 'style-loader' },
      { loader: 'css-loader' },
      { loader: 'postcss-loader' },
    ],
  },
  // Images are copied to the output and imported as their local URL.
  {
    test: /\.(png|jpe?g|webp|gif)$/,
    type: 'asset/resource',
  },
  // Font files referenced from CSS (the bundled Inter font) are copied too.
  {
    test: /\.(woff2?|ttf|otf)$/,
    type: 'asset/resource',
  },
];

const shared: Configuration = {
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

const base: Configuration = {
  ...shared,
  module: { rules: [...rules, ...assetRules] },
  plugins,
};

/**
 * The preload: the renderer's build, without Fast Refresh (it has no
 * React), and outside the dev server. Its hot updates would load into the
 * page, as script tags do, where they break the page's own; a sandboxed
 * preload can't take one anyway. Reload the window (or restart) after an
 * edit to it.
 */
export const preloadConfig: Configuration = {
  ...base,
  // The dev server skips a build whose devServer is false, though its
  // types don't allow it.
  devServer: false as unknown as Configuration['devServer'],
};

/**
 * The page. In `npm start`, React Fast Refresh swaps an edited component in
 * place, keeping its state, instead of reloading the page: a reload blanks
 * the window, which is clear down to the desktop on macOS. An edit Fast
 * Refresh can't take (a module that exports more than components) still
 * reloads. Packaged builds have none of it.
 */
export const rendererConfig = (
  _env: unknown,
  { mode }: Record<string, unknown>,
): Configuration => {
  if (mode !== 'development') return base;
  return {
    ...shared,
    module: {
      rules: [
        ...rules.filter((rule) => !isTypeScriptRule(rule)),
        {
          test: /\.tsx?$/,
          exclude: /(node_modules|\.webpack)/,
          use: {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
              getCustomTransformers: () => ({
                before: [ReactRefreshTypeScript()],
              }),
            },
          },
        },
        ...assetRules,
      ],
    },
    // The dev server already shows build errors over the page.
    plugins: [...plugins, new ReactRefreshPlugin({ overlay: false })],
  };
};

const isTypeScriptRule = (rule: (typeof rules)[number]) =>
  !!rule &&
  typeof rule === 'object' &&
  rule.test instanceof RegExp &&
  rule.test.source === /\.tsx?$/.source;
