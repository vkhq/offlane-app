import type { ComponentType } from 'react';

import type { ExternalToolId } from '../../shared/externalTools';
import type { FileKind } from '../../shared/fileKinds';
import type { ToolkitId } from '../../shared/toolkits';
import type { AppIcon } from '../components/icons';

/**
 * What the rest of the app knows about a tool: its manifest.ts. The sidebar,
 * Home, quick search, History and the tabs read only this; the tool's page
 * is loaded when it is first opened.
 */
export type ToolManifest = {
  /** Also the route path, e.g. `/compress-video`, and the folder's name. */
  id: string;
  name: string;
  /** One sentence shown under the page title and on tool cards. */
  description: string;
  icon: AppIcon;
  /**
   * The kinds of file it works on, as its page's input takes them. A run's
   * outputs offer the tools that accept their kind as the next step. Left
   * out by tools that take links or recordings.
   */
  accepts?: FileKind[];
  /** The card image on Home: a `banner.webp` beside the manifest, made by `npm run banners`. */
  banner?: string;
  /** Offered first: in the sidebar's Pinned list. */
  featured?: boolean;
  /** Other words quick search and Home's search find it by. */
  keywords?: string[];
  /**
   * The toolkits it needs (see src/shared/toolkits.ts). Until they are
   * installed its page offers to install them in place of its input, and
   * the main process refuses to run its jobs. A literal list: the main
   * build reads it from the source.
   */
  requires?: ToolkitId[];
  /**
   * A program the person installs themselves, which the app never ships
   * (see src/shared/externalTools.ts). The tool is hidden from the
   * sidebar, Home and quick search until it is turned on in Settings ›
   * Toolkits, and its page says so if opened another way.
   */
  enabledBy?: ExternalToolId;
};

/** Declares a tool's manifest; only here for the type. */
export const defineTool = (manifest: ToolManifest) => manifest;

/** A tool as the app lists it: its manifest and the group it is in. */
export type Tool = ToolManifest & { group: string };

export type ToolGroup = {
  id: string;
  name: string;
  /** Shown in the sidebar rail. */
  icon: AppIcon;
  tools: Tool[];
};

export type ToolPageProps = { tool: Tool };

/** A tool's page.tsx exports one of these as its default. */
export type ToolPage = ComponentType<ToolPageProps>;
