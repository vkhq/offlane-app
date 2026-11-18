// Turns yt-dlp's marked stdout lines into one overall progress number.
//
//   __R__"137+140"                            chosen formats (2 streams)
//   __P__{"fmt":"137","p":{...}}              per-stream download progress
//   __PP__{"pp":"Merger","status":"started"}  post-processing (ffmpeg)
//   __F__"/Users/me/Downloads/Title [id].mp4" final path
//
// A video+audio download is two transfers and then a merge. Showing each
// stream's own 0–100 would make the bar jump back halfway, so the transfers
// share 95% of one bar and post-processing gets the last 5%.
import type { Progress } from '../../shared/types';
import { MARK } from './args';

/** The part of yt-dlp's progress dict we use; every field may be missing. */
type RawProgress = {
  status?: 'downloading' | 'finished' | 'error';
  downloaded_bytes?: number;
  total_bytes?: number | null;
  total_bytes_estimate?: number | null;
  speed?: number | null;
  eta?: number | null;
  fragment_index?: number | null;
  fragment_count?: number | null;
};

export type ParsedLine =
  | { type: 'formats'; formatIds: string[] }
  | { type: 'progress'; formatId: string; raw: RawProgress }
  | { type: 'postprocess'; postprocessor: string; status: string }
  | { type: 'file'; path: string }
  | { type: 'other'; text: string };

/** Classifies one stdout line; malformed JSON counts as plain text. */
export function parseLine(line: string): ParsedLine {
  try {
    if (line.startsWith(MARK.formats)) {
      const value = JSON.parse(line.slice(MARK.formats.length));
      return {
        type: 'formats',
        formatIds: typeof value === 'string' ? value.split('+') : [],
      };
    }
    if (line.startsWith(MARK.postprocess)) {
      const value = JSON.parse(line.slice(MARK.postprocess.length));
      return {
        type: 'postprocess',
        postprocessor: String(value.pp ?? ''),
        status: String(value.status ?? ''),
      };
    }
    if (line.startsWith(MARK.progress)) {
      const value = JSON.parse(line.slice(MARK.progress.length));
      return {
        type: 'progress',
        formatId: String(value.fmt ?? ''),
        raw: (value.p ?? {}) as RawProgress,
      };
    }
    if (line.startsWith(MARK.file)) {
      return {
        type: 'file',
        path: JSON.parse(line.slice(MARK.file.length)) as string,
      };
    }
  } catch {
    // Fall through to plain text.
  }
  return { type: 'other', text: line };
}

/** Share of the bar used by the transfers. */
const downloadShare = 95;

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Feed it parsed lines and read `snapshot()` for the UI. */
export class ProgressTracker {
  private formatOrder: string[] = [];
  private stageIndex = 0;
  /** 0..1 within the current stage. */
  private stageFraction = 0;
  private postprocessing = false;
  private done = false;
  private last: Progress = {
    percent: 0,
    downloadedBytes: 0,
    totalBytes: null,
    speed: null,
    eta: null,
    stage: 1,
    stageCount: 1,
    fragmentIndex: null,
    fragmentCount: null,
  };

  constructor(private readonly isLive = false) {}

  /** Returns true when the snapshot changed. */
  feed(line: ParsedLine): boolean {
    switch (line.type) {
      case 'formats':
        this.formatOrder = line.formatIds;
        this.last.stageCount = Math.max(1, line.formatIds.length);
        return true;

      case 'progress': {
        const p = line.raw;
        const index = this.formatOrder.indexOf(line.formatId);
        if (index >= 0 && index !== this.stageIndex) {
          this.stageIndex = index;
          this.stageFraction = 0;
        }
        const downloaded = num(p.downloaded_bytes) ?? 0;
        // total_bytes is exact; the estimate is common for HLS/DASH.
        const total = num(p.total_bytes) ?? num(p.total_bytes_estimate);
        const fragmentIndex = num(p.fragment_index);
        const fragmentCount = num(p.fragment_count);

        if (p.status === 'finished') this.stageFraction = 1;
        else if (total && total > 0) {
          this.stageFraction = Math.min(1, downloaded / total);
        } else if (fragmentIndex !== null && fragmentCount) {
          this.stageFraction = Math.min(1, fragmentIndex / fragmentCount);
        }

        this.last = {
          ...this.last,
          downloadedBytes: downloaded,
          totalBytes: total,
          speed: num(p.speed),
          eta: num(p.eta),
          stage: this.stageIndex + 1,
          fragmentIndex,
          fragmentCount,
          percent: this.percent(),
        };
        return true;
      }

      case 'postprocess':
        if (line.status === 'started') this.postprocessing = true;
        this.last = {
          ...this.last,
          speed: null,
          eta: null,
          percent: this.percent(),
        };
        return true;

      case 'file':
        this.done = true;
        this.last = { ...this.last, percent: 100, speed: null, eta: null };
        return true;

      default:
        return false;
    }
  }

  get isPostprocessing(): boolean {
    return this.postprocessing && !this.done;
  }

  snapshot(): Progress {
    return { ...this.last };
  }

  private percent(): number | null {
    // Live streams have no end, so no percentage.
    if (this.isLive) return null;
    if (this.done) return 100;
    const perStage = downloadShare / Math.max(1, this.formatOrder.length);
    let percent = (this.stageIndex + this.stageFraction) * perStage;
    if (this.postprocessing) percent = Math.max(percent, downloadShare);
    // One decimal, so tiny changes don't flood IPC.
    return Math.round(Math.min(99.9, percent) * 10) / 10;
  }
}
