import type { WorktreeCheckoutProgress } from '../../shared/worktree/create-types'
import { createGitProgressRecordReader } from '../../shared/git-progress-records'

/** Receives checkout progress; `null` means git finished writing the files. */
export type WorktreeCheckoutProgressListener = (progress: WorktreeCheckoutProgress | null) => void

const MIN_REPORT_INTERVAL_MS = 100

export type WorktreeCheckoutProgressReader = {
  read: (stderrChunk: string) => void
  /** Stops all reporting; call once the git process has settled. */
  close: () => void
}

/**
 * Turns the `Updating files` meter that `git worktree add` already writes to
 * stderr into throttled progress reports. Leading-edge only, with no timer, so
 * nothing can report after the process ends.
 */
export function createWorktreeCheckoutProgressReader(
  onProgress: WorktreeCheckoutProgressListener,
  now: () => number = Date.now
): WorktreeCheckoutProgressReader {
  let lastPercent = -1
  let lastReportedAt = Number.NEGATIVE_INFINITY
  let closed = false
  const read = createGitProgressRecordReader('Updating files', (record) => {
    if (closed) {
      return
    }
    if (record.done) {
      closed = true
      onProgress(null)
      return
    }
    // Why: increases only, so a post-checkout hook's own checkout (or a WSL
    // fallback rerun) restarting at 0% never moves the bar backwards.
    if (record.percent <= lastPercent) {
      return
    }
    const at = now()
    if (record.percent < 100 && at - lastReportedAt < MIN_REPORT_INTERVAL_MS) {
      return
    }
    lastPercent = record.percent
    lastReportedAt = at
    onProgress({ percent: record.percent, completed: record.completed, total: record.total })
  })
  return {
    read,
    close: () => {
      closed = true
    }
  }
}
