import { type SVGProps, useId } from 'react';

/**
 * The app's own icon set: a 24-unit grid, a heavy 2-unit line with round ends
 * and joins, softly rounded corners, and small dash, dot and sparkle details.
 * Each icon also has a solid version (`filled`), with its inner details cut
 * out of the solid shape.
 *
 * An icon is made of SVG path data in up to seven parts:
 * - `body`: the main closed shape, filled in when the icon is filled;
 * - `cut`, `cutDots`, `cutSolid`: strokes, dots and solid marks inside the
 *   body, cut out of it when filled;
 * - `lines`, `dots`, `solid`: strokes, dots and solid marks that stay as they
 *   are either way.
 */
type Parts = {
  body?: string;
  cut?: string;
  cutDots?: string;
  cutSolid?: string;
  lines?: string;
  dots?: string;
  solid?: string;
};

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & {
  /** Width and height, in pixels or any CSS length. */
  size?: number | string;
  strokeWidth?: number;
  /** Draws the solid version. */
  filled?: boolean;
};

export type AppIcon = ((props: IconProps) => React.JSX.Element) & {
  displayName?: string;
};

// Shape helpers, as path data on the 24-unit grid.

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

const rect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
  `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
  `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;

/** A four-pointed sparkle with gently curved sides, centred on cx, cy. */
const sparkle = (cx: number, cy: number, r: number) => {
  const k = r * 0.2;
  return (
    `M${cx} ${cy - r}Q${cx + k} ${cy - k} ${cx + r} ${cy}` +
    `Q${cx + k} ${cy + k} ${cx} ${cy + r}Q${cx - k} ${cy + k} ${cx - r} ${cy}` +
    `Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`
  );
};

/** A seal: a circle edged with `lobes` rounded scallops, centred on cx, cy. */
const seal = (cx: number, cy: number, r: number, lobes: number) => {
  const at = (step: number) => {
    const angle = (step / lobes) * Math.PI * 2 - Math.PI / 2;
    return `${(cx + r * Math.cos(angle)).toFixed(2)} ${(cy + r * Math.sin(angle)).toFixed(2)}`;
  };
  const bulge = (r * Math.sin(Math.PI / lobes) * 1.12).toFixed(2);
  let path = `M${at(0)}`;
  for (let step = 1; step <= lobes; step += 1) {
    path += `A${bulge} ${bulge} 0 0 1 ${at(step)}`;
  }
  return `${path}Z`;
};

/** A page with a folded top-right corner, and that fold. */
const page =
  'M5 5a2 2 0 0 1 2-2h6.17a2 2 0 0 1 1.41.59l4.83 4.83A2 2 0 0 1 20 9.83V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z';
const fold = 'M13.5 3.25V7.5a1 1 0 0 0 1 1h4.25';

/** A loudspeaker facing right, for the volume icons. */
const speaker =
  'M3.5 10a1.5 1.5 0 0 1 1.5-1.5h2.4l3.9-3.2a.9.9 0 0 1 1.45.7v12a.9.9 0 0 1-1.45.7L7.4 15.5H5A1.5 1.5 0 0 1 3.5 14Z';

function makeIcon(name: string, parts: Parts): AppIcon {
  const { body, cut, cutDots, cutSolid, lines, dots, solid } = parts;

  function Icon({
    size = 24,
    strokeWidth = 2,
    filled = false,
    ...rest
  }: IconProps) {
    // Each filled icon cuts its details out with its own mask.
    const mask = useId();
    // Dots are drawn as round-capped points, a little heavier than lines.
    const dot = strokeWidth * 1.4;
    const solidFill = filled && !!body;

    return (
      <svg
        aria-hidden
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        {solidFill ? (
          <>
            <mask
              id={mask}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="24"
              height="24"
            >
              <rect width="24" height="24" fill="white" stroke="none" />
              {cut && <path d={cut} stroke="black" />}
              {cutDots && <path d={cutDots} stroke="black" strokeWidth={dot} />}
              {cutSolid && (
                <path
                  d={cutSolid}
                  fill="black"
                  stroke="black"
                  strokeWidth={1}
                />
              )}
            </mask>
            <path d={body} fill="currentColor" mask={`url(#${mask})`} />
          </>
        ) : (
          <>
            {body && <path d={body} />}
            {cut && <path d={cut} />}
            {cutDots && <path d={cutDots} strokeWidth={dot} />}
            {cutSolid && (
              <path d={cutSolid} fill="currentColor" strokeWidth={1} />
            )}
          </>
        )}
        {lines && <path d={lines} />}
        {dots && <path d={dots} strokeWidth={dot} />}
        {solid && <path d={solid} fill="currentColor" strokeWidth={1} />}
      </svg>
    );
  }

  Icon.displayName = name;
  return Icon;
}

// Navigation and chrome

export const Search = makeIcon('Search', {
  body: circle(10.5, 10.5, 7),
  cut: 'M7.75 10.5a2.75 2.75 0 0 1 2.75-2.75',
  lines: 'M15.75 15.75 20.5 20.5',
});

export const House = makeIcon('House', {
  body: 'M5 9.4 12 4.25l7 5.15V20H5Z',
  // Eaves past the walls, and a small arched door in the base.
  lines: 'M2.75 11 12 4.25 21.25 11',
  cut: 'M10 20v-3.25a2 2 0 0 1 4 0V20',
});

export const Clock = makeIcon('Clock', {
  body: circle(12, 13, 7.75),
  cut: 'M12 9.5V13h3',
  // A stem and cap on top, as on a stopwatch.
  lines: 'M12 3v2.25M9.75 3h4.5',
});

export const PanelLeft = makeIcon('PanelLeft', {
  body: rect(3.5, 4.5, 17, 15, 3.5),
  cut: 'M9.5 4.75v14.5',
});

export const Plus = makeIcon('Plus', { lines: 'M12 5v14M5 12h14' });

export const Minus = makeIcon('Minus', { lines: 'M5 12h14' });

export const X = makeIcon('X', { lines: 'm6.5 6.5 11 11m0-11-11 11' });

export const CaretDown = makeIcon('CaretDown', {
  solid: 'M8 10.5h8l-4 4.5Z',
});

export const ChevronLeft = makeIcon('ChevronLeft', {
  lines: 'm14.5 6-6 6 6 6',
});

export const ChevronRight = makeIcon('ChevronRight', {
  lines: 'm9.5 6 6 6-6 6',
});

export const ChevronDown = makeIcon('ChevronDown', {
  lines: 'm7 9.5 5 5 5-5',
});

export const Check = makeIcon('Check', { lines: 'm5 12.5 4.5 4.5L19 7.5' });

/** An open ring, spun to show that something is in progress. */
export const LoaderCircle = makeIcon('LoaderCircle', {
  lines: 'M20.5 12A8.5 8.5 0 1 1 12 3.5',
});

export const CircleAlert = makeIcon('CircleAlert', {
  body: circle(12, 12, 8.5),
  cut: 'M12 8v4.5',
  cutDots: 'M12 15.75h.01',
});

export const ArrowRight = makeIcon('ArrowRight', {
  lines: 'M5 12h14m-5.5-5.5L19 12l-5.5 5.5',
});

export const ArrowDownToLine = makeIcon('ArrowDownToLine', {
  lines: 'M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14',
});

export const ArrowLeftRight = makeIcon('ArrowLeftRight', {
  lines: 'M4 8.5h15M15.5 5 19 8.5 15.5 12M20 15.5H5M8.5 12 5 15.5 8.5 19',
});

export const Ellipsis = makeIcon('Ellipsis', {
  dots: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
});

export const GalleryHorizontal = makeIcon('GalleryHorizontal', {
  body: rect(7, 5, 10, 14, 2.5),
  lines: 'M3.5 7.5v9M20.5 7.5v9',
});

export const LayoutGrid = makeIcon('LayoutGrid', {
  body:
    rect(3.5, 3.5, 7, 7, 2) +
    rect(13.5, 3.5, 7, 7, 2) +
    rect(3.5, 13.5, 7, 7, 2) +
    rect(13.5, 13.5, 7, 7, 2),
});

export const LayoutList = makeIcon('LayoutList', {
  body: rect(3.5, 4, 6, 6, 2) + rect(3.5, 14, 6, 6, 2),
  lines: 'M13.5 7h7M13.5 17h7',
});

export const Square = makeIcon('Square', { body: rect(5.5, 5.5, 13, 13, 3) });

export const Play = makeIcon('Play', {
  body: 'M7.5 5.9v12.2a1.2 1.2 0 0 0 1.84 1.01l9.6-6.1a1.2 1.2 0 0 0 0-2.02l-9.6-6.1A1.2 1.2 0 0 0 7.5 5.9Z',
});

export const Globe = makeIcon('Globe', {
  body: circle(12, 12, 8.5),
  cut: 'M3.75 12h16.5M12 3.75C9.75 6.2 8.75 8.9 8.75 12s1 5.8 3.25 8.25M12 3.75c2.25 2.45 3.25 5.15 3.25 8.25s-1 5.8-3.25 8.25',
});

export const Info = makeIcon('Info', {
  body: circle(12, 12, 8.5),
  cut: 'M12 11.25v4.75M12 8h.01',
});

export const Link2 = makeIcon('Link2', {
  lines: 'M9 7H7.5a5 5 0 0 0 0 10H9m6-10h1.5a5 5 0 0 1 0 10H15m-6.5-5h7',
});

export const CloudUpload = makeIcon('CloudUpload', {
  lines:
    'M7.5 18.5H7a4.25 4.25 0 0 1-.66-8.45 6 6 0 0 1 11.6 0A4.25 4.25 0 0 1 17 18.5h-.5M12 20.5V13m-3 2.75 3-3 3 3',
});

// Files and folders

export const File = makeIcon('File', { body: page, cut: fold });

export const FileText = makeIcon('FileText', {
  body: page,
  cut: `${fold}M8.75 13h6.5M8.75 16.5h3.5`,
});

export const FilePdf = makeIcon('FilePdf', {
  // A minimal page: rounded, with a folded corner.
  body: 'M5 6.5A3.5 3.5 0 0 1 8.5 3h5.09a2 2 0 0 1 1.41.59l3.41 3.41A2 2 0 0 1 19 8.41V17.5a3.5 3.5 0 0 1-3.5 3.5h-7A3.5 3.5 0 0 1 5 17.5Z',
  cut: 'M13.5 3.25V7a1.5 1.5 0 0 0 1.5 1.5h3.75',
});

export const FileImage = makeIcon('FileImage', {
  body: page,
  cut: `${fold}M8.5 17.75l2.25-2.25 1.75 1.75 1-1 1.75 1.75`,
  cutDots: 'M9.75 12.25h.01',
});

export const FileMinus = makeIcon('FileMinus', {
  body: page,
  cut: `${fold}M9 15h6`,
});

export const FileOutput = makeIcon('FileOutput', {
  body: page,
  cut: `${fold}M8.75 15h6m-2.25-2.5 2.5 2.5-2.5 2.5`,
});

export const FileArchive = makeIcon('FileArchive', {
  body: page,
  cut: `${fold}M10 4.5v1M10 8v1M10 11.5v1`,
  cutSolid: rect(8.75, 15, 2.5, 3, 0.75),
});

export const FilePenLine = makeIcon('FilePenLine', {
  body: page,
  cut: `${fold}M8.75 17.5h1.5l4.25-4.25a1.06 1.06 0 0 0-1.5-1.5L8.75 16Z`,
});

export const Files = makeIcon('Files', {
  body: 'M8 8a2 2 0 0 1 2-2h5.17a2 2 0 0 1 1.41.59l3.83 3.83A2 2 0 0 1 21 11.83V19a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2Z',
  cut: 'M15.5 6.25V9.5a1 1 0 0 0 1 1h4.25',
  lines: 'M4.5 16.5V5.5A2.5 2.5 0 0 1 7 3h6',
});

export const Folder = makeIcon('Folder', {
  body: 'M3 7a2.5 2.5 0 0 1 2.5-2.5h3.1a2 2 0 0 1 1.5.68L11.5 6.75h7A2.5 2.5 0 0 1 21 9.25v8.25A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5Z',
  cut: 'M3.25 10.25h17.5',
});

export const FolderOpen = makeIcon('FolderOpen', {
  body: 'M3.5 18.5 6 12.1a2 2 0 0 1 1.86-1.27h12.2a1 1 0 0 1 .94 1.35l-2.06 5.5A2 2 0 0 1 17.07 19H4a.5.5 0 0 1-.5-.5Z',
  lines:
    'M3.5 18.5V7a2 2 0 0 1 2-2h3.17a2 2 0 0 1 1.41.59L11.5 7H17a2 2 0 0 1 2 2v1.5',
});

export const Save = makeIcon('Save', {
  body: 'M4 6a2 2 0 0 1 2-2h10.17a2 2 0 0 1 1.41.59l2.83 2.83A2 2 0 0 1 21 8.83V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z',
  cut: 'M8 4.25V8h6.5M8 19.75V15h8v4.75',
});

// Media

export const Video = makeIcon('Video', {
  body: rect(2.5, 5.5, 13.5, 13, 3.25),
  cut: 'M8 9.75v4.5L11.5 12Z',
  lines: 'M16 10.25l5.5-3v9.5l-5.5-3',
});

export const Film = makeIcon('Film', {
  body: rect(3.5, 3.5, 17, 17, 3.5),
  cut: 'M8 3.75v16.5M16 3.75v16.5M3.75 12h4.25M16 12h4.25',
});

export const ListVideo = makeIcon('ListVideo', {
  body: 'M15 13.7v5.6a.8.8 0 0 0 1.22.68l4.2-2.8a.8.8 0 0 0 0-1.36l-4.2-2.8A.8.8 0 0 0 15 13.7Z',
  lines: 'M3.5 6h13M3.5 11h13M3.5 16h7',
});

export const Images = makeIcon('Images', {
  body: rect(2.5, 7, 15.5, 13.5, 2.5),
  cut: 'm5.75 17.5 3.25-3.25 2.25 2.25 1.5-1.5 2 2',
  cutDots: 'M13.25 10.75h.01',
  lines: 'M6.5 3.5h12a3 3 0 0 1 3 3V16',
});

export const Image = makeIcon('Image', {
  body: rect(3.5, 3.5, 17, 17, 4),
  cut: 'm7 17 3.5-4.25 2.25 2.5 1.75-1.75L17 17',
  cutDots: 'M15 8.75h.01',
});

export const Camera = makeIcon('Camera', {
  body: 'M3.5 9a2 2 0 0 1 2-2h2l1.4-2.1A2 2 0 0 1 10.57 4h2.86a2 2 0 0 1 1.67.9L16.5 7h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z',
  cut: circle(12, 13, 3.5),
});

export const Crop = makeIcon('Crop', {
  lines: 'M6.5 3v12.5a2 2 0 0 0 2 2H21M3 6.5h12.5a2 2 0 0 1 2 2V21',
});

/** A wide frame with a tall one inside it: a change of shape. */
export const Ratio = makeIcon('Ratio', {
  body: rect(3, 5.5, 18, 13, 3),
  cut: 'M10 8.75h4a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4.5a1 1 0 0 1 1-1Z',
});

export const CircleArrowDown = makeIcon('CircleArrowDown', {
  body: circle(12, 12, 8.5),
  cut: 'M12 8v7.5m-3.25-3.25L12 15.5l3.25-3.25',
});

export const CircleDot = makeIcon('CircleDot', {
  body: circle(12, 12, 8.5),
  cutSolid: circle(12, 12, 2.5),
});

export const RefreshCw = makeIcon('RefreshCw', {
  lines:
    'M20 11a8 8 0 0 0-14.3-4.6L4 8m0-4v4h4m12 5a8 8 0 0 1-14.3 4.6L4 16m16 4v-4h-4',
});

export const RotateCw = makeIcon('RotateCw', {
  lines: 'M20 12a8 8 0 1 1-2.34-5.66L20 8.5M20 4v4.5h-4.5',
});

export const RotateCcw = makeIcon('RotateCcw', {
  lines: 'M4 12a8 8 0 1 0 2.34-5.66L4 8.5M4 4v4.5h4.5',
});

export const Repeat = makeIcon('Repeat', {
  lines:
    'm17 2.5 3 3-3 3M4 11.5V10a4.5 4.5 0 0 1 4.5-4.5H20M7 21.5l-3-3 3-3m13-3V14a4.5 4.5 0 0 1-4.5 4.5H4',
});

export const Scissors = makeIcon('Scissors', {
  body: circle(6.5, 6.5, 2.75) + circle(6.5, 17.5, 2.75),
  lines: 'M8.75 8.1 20 18M8.75 15.9 20 6',
});

export const Gauge = makeIcon('Gauge', {
  lines: 'M5.2 18a8.5 8.5 0 1 1 13.6 0M12 13l3.25-3.75',
  dots: 'M12 13h.01',
});

export const Minimize2 = makeIcon('Minimize2', {
  lines: 'M4.5 14H10v5.5M10 14l-6 6M19.5 10H14V4.5M14 10l6-6',
});

export const Maximize2 = makeIcon('Maximize2', {
  lines: 'M14.5 4H20v5.5M20 4l-6 6M9.5 20H4v-5.5M4 20l6-6',
});

export const MoveDiagonal2 = makeIcon('MoveDiagonal2', {
  lines: 'M14 4h6v6M10 20H4v-6M20 4 4 20',
});

export const MoveHorizontal = makeIcon('MoveHorizontal', {
  lines: 'M3.5 12h17M7 8.5 3.5 12 7 15.5m10-7 3.5 3.5-3.5 3.5',
});

export const MoveVertical = makeIcon('MoveVertical', {
  lines: 'M12 3.5v17M8.5 7 12 3.5 15.5 7m-7 10 3.5 3.5 3.5-3.5',
});

export const FlipHorizontal2 = makeIcon('FlipHorizontal2', {
  body: 'M9 7.6V17H4.3a.75.75 0 0 1-.66-1.1l4.6-8.6a.4.4 0 0 1 .76.2Z',
  lines:
    'M15 7.6V17h4.7a.75.75 0 0 0 .66-1.1l-4.6-8.6a.4.4 0 0 0-.76.2ZM12 3v2m0 4v2m0 4v2m0 4v1',
});

/** Two halves mirrored across the middle, under a two-way arrow. */
export const FlipSides = makeIcon('FlipSides', {
  lines:
    'M10.5 9.5V20H3.75ZM13.5 9.5V20h6.75ZM4 4.5h16M6 2.5l-2 2 2 2m12-4 2 2-2 2',
});

/** A square with an arrow curling back over it: a quarter turn left. */
export const RotateSquareCcw = makeIcon('RotateSquareCcw', {
  body: rect(3.5, 10, 11, 11, 2.25),
  lines: 'M19 11V7.5A3.5 3.5 0 0 0 15.5 4h-3M15 1.5 12.5 4 15 6.5',
});

/** RotateSquareCcw mirrored: a quarter turn right. */
export const RotateSquareCw = makeIcon('RotateSquareCw', {
  body: rect(9.5, 10, 11, 11, 2.25),
  lines: 'M5 11V7.5A3.5 3.5 0 0 1 8.5 4h3M9 1.5 11.5 4 9 6.5',
});

export const SquareSplitHorizontal = makeIcon('SquareSplitHorizontal', {
  lines:
    'M8.5 4h-2A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h2m7-16h2A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-2M12 3v18',
});

export const Eraser = makeIcon('Eraser', {
  body: 'M8.2 20 3.9 15.7a2 2 0 0 1 0-2.83l9-9a2 2 0 0 1 2.83 0l4.4 4.4a2 2 0 0 1 0 2.83L11 20Z',
  cut: 'm8.5 10.25 5.5 5.5',
  lines: 'M11 20h9',
});

export const Tag = makeIcon('Tag', {
  body: 'M3.5 5.5v5.17a2 2 0 0 0 .59 1.41l7.83 7.83a2 2 0 0 0 2.83 0l5.17-5.17a2 2 0 0 0 0-2.83L12.08 4.09a2 2 0 0 0-1.41-.59H5.5a2 2 0 0 0-2 2Z',
  cutDots: 'M8 8h.01',
});

export const Lock = makeIcon('Lock', {
  body: rect(4.5, 10.5, 15, 10, 3),
  cut: 'M12 14.25v2.5',
  lines: 'M8 10.5V8a4 4 0 0 1 8 0v2.5',
});

export const LockOpen = makeIcon('LockOpen', {
  body: rect(4.5, 10.5, 15, 10, 3),
  cut: 'M12 14.25v2.5',
  lines: 'M8 10.5V8a4 4 0 0 1 7.75-1.4',
});

export const PenLine = makeIcon('PenLine', {
  body: 'M4 20v-3.3a1 1 0 0 1 .3-.7L15.1 5.2a2.12 2.12 0 0 1 3 0l.7.7a2.12 2.12 0 0 1 0 3L8 19.7a1 1 0 0 1-.7.3Z',
  cut: 'm13.5 6.75 3.75 3.75',
  lines: 'M13 20h7',
});

export const Sparkles = makeIcon('Sparkles', {
  body: sparkle(10, 11, 7),
  solid: sparkle(18.5, 5, 2.5) + sparkle(18.5, 18, 1.75),
});

export const BadgeCheck = makeIcon('BadgeCheck', {
  body: seal(12, 12, 7.6, 8),
  cut: 'm8.75 12.25 2.25 2.25 4.25-4.5',
});

export const WandSparkles = makeIcon('WandSparkles', {
  body: 'm14.25 7.25 2.5 2.5-1.75 1.75-2.5-2.5Z',
  lines: 'M4 20l8.5-8.5',
  solid: sparkle(19, 5, 2.5) + sparkle(8.5, 5, 1.75) + sparkle(19, 14.5, 1.75),
});

export const SlidersHorizontal = makeIcon('SlidersHorizontal', {
  body: circle(15, 7, 2.25) + circle(9, 17, 2.25),
  lines: 'M3.5 7h9.25M17.25 7h3.25M3.5 17h3.25M11.25 17h9.25',
});

export const MapPin = makeIcon('MapPin', {
  body: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z',
  cut: circle(12, 10, 2.25),
});

export const Calendar = makeIcon('Calendar', {
  body: rect(3.5, 5, 17, 15.5, 3),
  cut: 'M3.75 10h16.5M7.75 14.5h3',
  lines: 'M8 3v4M16 3v4',
});

export const Hash = makeIcon('Hash', {
  lines: 'M9.5 4 8 20M16 4l-1.5 16M4.5 9h15.5M4 15h15.5',
});

export const ListOrdered = makeIcon('ListOrdered', {
  lines: 'M10 6.5h10M10 12h10M10 17.5h10',
  dots: 'M5.5 6.5h.01M5.5 12h.01M5.5 17.5h.01',
});

// Sound

export const Music = makeIcon('Music', {
  body: circle(8, 17, 3.5),
  // A single stem whose flag curls over, like a cable.
  lines: 'M11.5 17V3.5c.6 2.4 2.5 3.5 4.5 4 1.8.45 3.2 1.6 3.5 3.5',
});

export const Mic = makeIcon('Mic', {
  body: rect(8.75, 3, 6.5, 11.5, 3.25),
  cut: 'M11 7h2',
  lines: 'M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21m-3 0h6',
});

export const AudioLines = makeIcon('AudioLines', {
  lines: 'M4 10.5v3M8 7v10M12 4v16M16 8v8M20 10.5v3',
});

export const AudioWaveform = makeIcon('AudioWaveform', {
  lines: 'M2.5 12.5h2.25L7 7l3.25 11L13.5 5l2.75 10 1.5-2.5h3.75',
});

export const Volume2 = makeIcon('Volume2', {
  body: speaker,
  lines: 'M16 9.25a4 4 0 0 1 0 5.5M18.75 6.5a7.75 7.75 0 0 1 0 11',
});

export const VolumeX = makeIcon('VolumeX', {
  body: speaker,
  lines: 'm16.5 9.5 5 5m0-5-5 5',
});

// Text and language

export const Type = makeIcon('Type', {
  lines: 'M5.5 7V5h13v2M12 5v14m-2.5 0h5',
});

export const TextSquare = makeIcon('TextSquare', {
  // A wide key with a letter on it.
  body: rect(2.75, 5.5, 18.5, 13, 3.25),
  cut: 'M8.75 9.5h6.5M12 9.5v5.5',
});

export const CaseSensitive = makeIcon('CaseSensitive', {
  body: circle(17, 14.5, 3),
  lines: 'm3 17.5 4-11 4 11M4.5 13.5h5M20 11.5v6',
});

export const Languages = makeIcon('Languages', {
  lines:
    'M3.5 6h9M8 4v2m2.5 0c-.8 3.6-3 6.2-6 7.5m1.5-4c1.2 1.75 2.75 3 4.5 3.75M12.5 20l4-9.5 4 9.5M14 16.5h5',
});

export const Captions = makeIcon('Captions', {
  body: rect(3, 5, 18, 14, 3.5),
  cut: 'M10.75 10.25a2.25 2.25 0 1 0 0 3.5M16.75 10.25a2.25 2.25 0 1 0 0 3.5',
});

export const Subtitles = makeIcon('Subtitles', {
  body: rect(3, 5, 18, 14, 3.5),
  cut: 'M7 12h3.5M14 12h3M7 15.5h6M16 15.5h1',
});

export const MessageSquareText = makeIcon('MessageSquareText', {
  body: 'M3.5 6.5a2.5 2.5 0 0 1 2.5-2.5h12a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5H9.25l-4.3 3.1a.9.9 0 0 1-1.45-.73Z',
  cut: 'M8 9h8M8 12.75h5',
});

export const TextQuote = makeIcon('TextQuote', {
  lines: 'M4 5.5h16M9.5 10.5H20M9.5 15h10.5M4 20h12M4.5 10.5V15',
});

export const ScanText = makeIcon('ScanText', {
  lines:
    'M4 8.5v-2A2.5 2.5 0 0 1 6.5 4h2m7 0h2A2.5 2.5 0 0 1 20 6.5v2m0 7v2a2.5 2.5 0 0 1-2.5 2.5h-2m-7 0h-2A2.5 2.5 0 0 1 4 17.5v-2M8.5 9h7m-7 3h7m-7 3h4',
});
