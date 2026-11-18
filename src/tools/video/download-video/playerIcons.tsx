import type { SVGProps } from 'react';

// The player's own icons, drawn on the same 24px grid as the app's set
// (components/icons.tsx), which has no pause, seek or fullscreen glyphs.

type Props = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/** Two solid bars. */
export function Pause({ size = 24, ...rest }: Props) {
  return (
    <svg {...base(size)} {...rest}>
      <rect
        x="6"
        y="5"
        width="4"
        height="14"
        rx="1.2"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="14"
        y="5"
        width="4"
        height="14"
        rx="1.2"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/** A circling arrow with the seconds in it: back that far, or forward. */
export function Seek({
  size = 24,
  forward = false,
  seconds,
  ...rest
}: Props & { forward?: boolean; seconds: number }) {
  return (
    <svg {...base(size)} strokeWidth={1.8} {...rest}>
      <g transform={forward ? 'translate(24 0) scale(-1 1)' : undefined}>
        <path d="M4.6 9.5A8 8 0 1 1 4 12" />
        <path d="M4.2 4.8v4.9h4.9" />
      </g>
      <text
        x="12.4"
        y="15.2"
        textAnchor="middle"
        fontSize="7"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
      >
        {seconds}
      </text>
    </svg>
  );
}

/** Four corners, pointing out; or in, to leave full screen. */
export function Fullscreen({
  size = 24,
  exit = false,
  ...rest
}: Props & { exit?: boolean }) {
  return (
    <svg {...base(size)} {...rest}>
      <path
        d={
          exit
            ? 'M9 4v3a2 2 0 0 1-2 2H4M15 4v3a2 2 0 0 0 2 2h3M9 20v-3a2 2 0 0 0-2-2H4M15 20v-3a2 2 0 0 1 2-2h3'
            : 'M4 9V6a2 2 0 0 1 2-2h3M20 9V6a2 2 0 0 0-2-2h-3M4 15v3a2 2 0 0 0 2 2h3M20 15v3a2 2 0 0 1-2 2h-3'
        }
      />
    </svg>
  );
}

/** Three dots, stacked. */
export function MoreVertical({ size = 24, ...rest }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2.8} {...rest}>
      <path d="M12 5.5h.01M12 12h.01M12 18.5h.01" />
    </svg>
  );
}

/** A filled screen with a plus knocked out of it: picture in picture. */
export function PictureInPicture({ size = 24, ...rest }: Props) {
  return (
    <svg {...base(size)} {...rest}>
      <path
        fill="currentColor"
        stroke="none"
        fillRule="evenodd"
        d="M5 5.5h14a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 16V8A2.5 2.5 0 0 1 5 5.5Zm3 3.6a.9.9 0 0 0-.9.9v1.1H6a.9.9 0 0 0 0 1.8h1.1V14a.9.9 0 0 0 1.8 0v-1.1H10a.9.9 0 0 0 0-1.8H8.9V10a.9.9 0 0 0-.9-.9Z"
      />
    </svg>
  );
}
