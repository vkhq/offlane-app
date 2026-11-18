import { useEffect, useState } from 'react';

// Ten tools to suggest, in the order they are shown.
const suggestions = [
  'Compress Video',
  'Download Video',
  'Merge PDFs',
  'Remove Background',
  'Convert Images',
  'Trim Audio',
  'Transcribe',
  'Video to GIF',
  'Add Password',
  'Batch Rename',
];

// Milliseconds per step of the typing cycle.
const typeDelay = 70;
const eraseDelay = 35;
/** How long a finished name stays before it is erased. */
const holdDelay = 1400;
/** The pause on an empty field before the next name is typed. */
const gapDelay = 300;

const reduceMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Stands in for a search field's placeholder, which cannot be animated: tool
 * names are typed out one letter at a time, held, erased, and the next one is
 * typed. Render it only while the field is empty.
 */
export function RotatingPlaceholder() {
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(0);
  const [erasing, setErasing] = useState(false);

  const word = suggestions[index];

  useEffect(() => {
    // With Reduce Motion on, whole names simply take turns.
    if (reduceMotion()) {
      setLength(word.length);
      const timer = setTimeout(
        () => setIndex((index + 1) % suggestions.length),
        holdDelay + gapDelay,
      );
      return () => clearTimeout(timer);
    }

    const [delay, step] = !erasing
      ? length < word.length
        ? [typeDelay, () => setLength(length + 1)]
        : [holdDelay, () => setErasing(true)]
      : length > 0
        ? [eraseDelay, () => setLength(length - 1)]
        : [
            gapDelay,
            () => {
              setErasing(false);
              setIndex((index + 1) % suggestions.length);
            },
          ];

    const timer = setTimeout(step, delay);
    return () => clearTimeout(timer);
  }, [index, length, erasing, word]);

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-[14px] whitespace-nowrap text-ink-faint"
    >
      {word.slice(0, length)}
    </span>
  );
}
