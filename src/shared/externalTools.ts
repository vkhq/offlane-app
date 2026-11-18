// Programs the app never ships or downloads, but uses when the person has
// installed them on their computer themselves. Today that is yt-dlp, run by
// the Download Video tool. Whatever yt-dlp needs to work is the person's to
// install along with it; the app knows only yt-dlp.
// That tool is hidden until it is turned on in Settings › Toolkits, under
// "Found on This Computer", and the main process refuses its jobs until
// then (see src/main/engine/external.ts).
//
// No Electron, Node or React import: both processes use this file.

/** A program that turns a tool on: the manifest's `enabledBy`. */
export type ExternalToolId = 'ytdlp';

/** A program found on this computer that answered `--version`. */
export type FoundProgram = {
  path: string;
  version: string;
  /** Picked by the person, rather than found on its own. */
  chosen: boolean;
};

export type ExternalToolsStatus = {
  ytdlp: {
    found: FoundProgram | null;
    /** Why one that was found can't be used, such as not starting. */
    problem: string | null;
    /** Download Video is turned on. */
    enabled: boolean;
  };
  /** A look for them is under way. */
  scanning: boolean;
};

/** What the preload exposes to the page as `window.externalTools`. */
export type ExternalToolsApi = {
  status(): Promise<ExternalToolsStatus>;
  /** Looks for the programs again, after the person installs one. */
  rescan(): Promise<ExternalToolsStatus>;
  /** Asks for yt-dlp's file in a dialog, and uses it if it runs. */
  chooseYtdlp(): Promise<ExternalToolsStatus>;
  /** Goes back to finding yt-dlp on its own. */
  forgetChosenYtdlp(): Promise<ExternalToolsStatus>;
  /** Turns Download Video on or off. On needs a yt-dlp that was found. */
  setEnabled(id: ExternalToolId, on: boolean): Promise<ExternalToolsStatus>;
  onChanged(cb: (status: ExternalToolsStatus) => void): () => void;
};

export const externalToolNames: Record<ExternalToolId, string> = {
  ytdlp: 'yt-dlp',
};

/**
 * A yt-dlp version ("2026.10.26") as its age in days on `now`, or null if
 * it isn't one. Sites change often, and an old yt-dlp is the usual reason a
 * download that worked stops working.
 */
export function ytdlpAgeDays(version: string, now = Date.now()) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  return Math.floor((now - Date.UTC(year, month - 1, day)) / 86_400_000);
}
