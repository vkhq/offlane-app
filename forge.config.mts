import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import { contentSecurityPolicy } from './src/shared/csp';
import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

// Signing and notarizing run only when the credentials are in the
// environment, so local builds stay unsigned.
const identity = process.env.APPLE_SIGNING_IDENTITY;
const notarize =
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID
    ? {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      }
    : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // The GPL text travels with every build, at Resources/LICENSE (macOS)
    // or resources/LICENSE (Windows, Linux).
    extraResource: ['LICENSE'],
    // No native programs are bundled: FFmpeg comes as a toolkit, downloaded
    // on demand into the user's data folder (see src/main/toolkits and
    // `npm run publish-toolkits`). yt-dlp is never shipped or downloaded;
    // the app uses one only if the person installed it themselves.
    osxSign: identity
      ? {
          identity,
          // The app gets its own entitlements; every other binary gets the
          // inherited set.
          optionsForFile: (filePath) => ({
            hardenedRuntime: true,
            entitlements: filePath.endsWith('.app')
              ? 'build/entitlements.mac.plist'
              : 'build/entitlements.mac.inherit.plist',
          }),
        }
      : undefined,
    osxNotarize: identity ? notarize : undefined,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      // Override when another dev server already holds the default port.
      port: Number(process.env.FORGE_PORT) || 3000,
      // The app's own policy, plus the dev server's live-reload socket.
      // Forge's default allows eval, which Electron warns about.
      devContentSecurityPolicy: `${contentSecurityPolicy}; connect-src 'self' ws://localhost:*`,
      // The router puts real paths in the URL, so reloading on one (or a
      // live reload) must get the page, which lives under its entry's name.
      devServer: {
        historyApiFallback: { index: '/main_window/index.html' },
      },
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/index.html',
            js: './src/renderer/index.tsx',
            name: 'main_window',
            preload: {
              js: './src/preload/index.ts',
            },
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
