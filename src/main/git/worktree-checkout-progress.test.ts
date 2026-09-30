import { describe, expect, it } from 'vitest'
import type { WorktreeCheckoutProgress } from '../../shared/worktree/create-types'
import { createWorktreeCheckoutProgressReader } from './worktree-checkout-progress'

function record(completed: number, total: number, done = false): string {
  const percent = Math.floor((completed * 100) / total)
  return `Updating files: ${String(percent).padStart(3)}% (${completed}/${total})${done ? ', done.\n' : '\r'}`
}

function harness(): {
  reports: (WorktreeCheckoutProgress | null)[]
  clock: { now: number }
  reader: ReturnType<typeof createWorktreeCheckoutProgressReader>
} {
  const reports: (WorktreeCheckoutProgress | null)[] = []
  const clock = { now: 0 }
  const reader = createWorktreeCheckoutProgressReader(
    (progress) => reports.push(progress),
    () => clock.now
  )
  return { reports, clock, reader }
}

describe('createWorktreeCheckoutProgressReader', () => {
  it('reports at most once per 100 ms, and always reports 100% and the end of the checkout', () => {
    const { reports, clock, reader } = harness()
    reader.read(record(1, 100))
    clock.now = 50
    reader.read(record(2, 100))
    clock.now = 99
    reader.read(record(3, 100))
    clock.now = 100
    reader.read(record(4, 100))
    clock.now = 110
    reader.read(record(100, 100))
    reader.read(record(100, 100, true))

    expect(reports).toEqual([
      { percent: 1, completed: 1, total: 100 },
      { percent: 4, completed: 4, total: 100 },
      { percent: 100, completed: 100, total: 100 },
      null
    ])
  })

  it('never moves backwards, so a hook re-running a checkout from 0% is ignored', () => {
    const { reports, clock, reader } = harness()
    reader.read(record(40, 100))
    clock.now = 1_000
    reader.read(record(0, 100))
    reader.read(record(40, 100))
    clock.now = 2_000
    reader.read(record(41, 100))

    expect(reports.map((progress) => progress?.percent)).toEqual([40, 41])
  })

  it('reports nothing after the checkout is done', () => {
    const { reports, clock, reader } = harness()
    reader.read(record(10, 10))
    reader.read(record(10, 10, true))
    clock.now = 1_000
    // A post-checkout hook running its own checkout writes to the same pipe.
    reader.read(record(5, 10))
    reader.read(record(10, 10))
    reader.read(record(10, 10, true))

    expect(reports).toEqual([{ percent: 100, completed: 10, total: 10 }, null])
  })

  it('reports nothing once closed, which the create does when git exits or fails', () => {
    const { reports, clock, reader } = harness()
    reader.read(record(3, 10))
    reader.close()
    clock.now = 1_000
    reader.read(record(9, 10))
    reader.read(record(10, 10, true))

    expect(reports).toEqual([{ percent: 30, completed: 3, total: 10 }])
  })

  it('ignores stderr that carries no checkout meter', () => {
    const { reports, reader } = harness()
    reader.read("Preparing worktree (new branch 'feature')\n")
    reader.read('fatal: could not create work tree dir\n')

    expect(reports).toEqual([])
  })
})
