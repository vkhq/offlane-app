declare module '*.css';

declare module '*.jpg' {
  const url: string;
  export default url;
}

declare module '*.webp' {
  const url: string;
  export default url;
}

/** A context menu line: an item, or null for a divider. */
type MenuLine = { id: string; label: string; enabled?: boolean } | null;

/** What the preload script exposes to the page. */
interface Window {
  app: {
    /** Whether macOS's translucent sidebar material is behind the window. */
    vibrancy: boolean;
    quit: () => void;
    /** The full name of the person signed in to this computer. */
    userName: () => Promise<string>;
    /** This app's version, from package.json. */
    version: () => Promise<string>;
    /** Shows a native menu at the pointer; resolves to the chosen id. */
    contextMenu: (lines: MenuLine[]) => Promise<string | null>;
  };
  downloader: import('../shared/types').DownloaderApi;
  toolkits: import('../shared/toolkits').ToolkitsApi;
  externalTools: import('../shared/externalTools').ExternalToolsApi;
  storage: import('../shared/storage').StorageApi;
  tools: import('../shared/tools').ToolsApi;
  sessions: import('../shared/types').SessionsApi;
  media: import('../shared/types').MediaApi;
}
