import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import { DefinePlugin } from 'webpack';

// oxlint-disable-next-line @typescript-eslint/no-require-imports
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

export const plugins = [
  new ForkTsCheckerWebpackPlugin({
    logger: 'webpack-infrastructure',
  }),
  // Whether this is an official build, fixed when it is built: only the
  // release workflow sets OFFLANE_OFFICIAL_BUILD=1 (see shared/brand.ts).
  new DefinePlugin({
    __OFFLANE_OFFICIAL_BUILD__: JSON.stringify(
      process.env.OFFLANE_OFFICIAL_BUILD === '1',
    ),
  }),
];
