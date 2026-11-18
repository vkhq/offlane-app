/** A thin bar for a 0–100 value; no value shows an empty track. */
export function ProgressBar({
  value,
  label,
}: {
  value: number | null;
  label: string;
}) {
  return (
    <progress
      aria-label={label}
      max={100}
      value={value ?? 0}
      className="h-1 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-group [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-flow [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-300"
    />
  );
}
