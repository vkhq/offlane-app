# Tests

Tests for the main process, preload and renderer go here, mirroring the
folders beside this one. No unit test runner is set up yet.

## Integration

`integration.ts` runs the download engine and the FFmpeg installer under plain
Node, against a local server, so it needs no internet. Fetch the binaries
first (`npm run fetch-binaries`), then run `npm run test:integration`.

## End to end

`e2e/tabs.mjs` drives a running app window over the Chrome DevTools Protocol
and checks routing and tabs: navigation within and across tabs, per-tab
Back/Forward, only the active tab mounted with its state kept, background
tabs, closing and reopening, and reloading with several tabs open.
`OFFLANE_USE_VENDOR=1` makes the app count `vendor/`'s programs as installed
toolkits; without it a development build has none, as a fresh install does.

```sh
OFFLANE_USE_VENDOR=1 FORGE_PORT=3100 npx electron-forge start -- --remote-debugging-port=9333
npm run test:e2e
```

`e2e/download.mjs` checks Download Video end to end: the link drawn between
the steps while looking up and once found, the preview card, a download
saved to the save folder, and the errors shown when a lookup or download
fails. It starts and quits its own copy of the app, with its own data and
save folders, on ports 3100 and 9333 (`FORGE_PORT`, `CDP_PORT`).

```sh
npm run test:download          # offline: mocks, no network calls
npm run test:download:online   # vendor/'s real yt-dlp against YouTube
```

Offline, the app runs with `OFFLANE_MOCKS` set to a folder holding a fake
yt-dlp (`mocks/yt-dlp.mjs`) and the clip and thumbnail it hands out, and the
main process's `fetch` serves only from that folder (`src/main/mocks.ts`).
The video id in a link picks the outcome: `mock-ok`, `mock-timeout` or
`mock-download-fail`. Development builds only; a packaged app ignores it.

For a packaged build, launch the app binary with `--remote-debugging-port=9333`
and run with `APP_URL=app://bundle/main_window/`. Set `CDP_PORT` for another
debugging port.
