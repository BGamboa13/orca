import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalPtyLaunchPlan, resolveLocalPtyWslDistro } from './local-pty-launch-plan'
import type { LocalPtyProviderOptions } from './local-pty-provider-types'
import type { PtySpawnOptions } from './types'
import { resolveWslLaunchDirectory } from './wsl-launch-directory-resolution'
import type * as WslModule from '../wsl'

const { wslHome } = vi.hoisted(() => ({ wslHome: vi.fn() }))
vi.mock('../wsl', async (importOriginal) => ({
  ...(await importOriginal<typeof WslModule>()),
  getDefaultWslDistro: () => 'Debian',
  getWslHomeAsync: wslHome
}))
vi.mock('./local-pty-utils', () => ({
  ensureNodePtySpawnHelperExecutable: vi.fn(),
  validateWorkingDirectory: vi.fn()
}))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
})
afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.clearAllMocks()
})

describe('resolveWslLaunchDirectory', () => {
  it("names a cache directory in the distro's home both ways", async () => {
    wslHome.mockResolvedValue('\\\\wsl.localhost\\Ubuntu\\home\\ada')
    await expect(resolveWslLaunchDirectory('Ubuntu')).resolves.toEqual({
      distro: 'Ubuntu',
      windowsPath: '\\\\wsl.localhost\\Ubuntu\\home\\ada\\.cache\\orca',
      linuxPath: '/home/ada/.cache/orca'
    })
    expect(wslHome).toHaveBeenCalledWith('Ubuntu')
  })

  it('has none for a spawn outside WSL or a distro whose home cannot be read', async () => {
    await expect(resolveWslLaunchDirectory(undefined)).resolves.toBeUndefined()
    wslHome.mockResolvedValue(null)
    await expect(resolveWslLaunchDirectory('Ubuntu')).resolves.toBeUndefined()
  })
})

describe('resolveLocalPtyWslDistro', () => {
  // Why: the launch file goes into this distro, so it must be the one the plan starts.
  it.each<[string, Partial<PtySpawnOptions>, string]>([
    ['a WSL worktree path', { cwd: '\\\\wsl.localhost\\Ubuntu\\home\\ada\\repo' }, 'Ubuntu'],
    [
      'a WSL worktree id',
      { cwd: 'C:\\work', worktreeId: 'repo::\\\\wsl.localhost\\Arch\\home\\ada\\repo' },
      'Arch'
    ],
    [
      'a WSL tab with a chosen distro',
      { cwd: 'C:\\work', shellOverride: 'wsl.exe', terminalWindowsWslDistro: 'Alpine' },
      'Alpine'
    ],
    ['a WSL tab on the default distro', { cwd: 'C:\\work', shellOverride: 'wsl.exe' }, 'Debian'],
    ['WSL as the default shell', { cwd: 'C:\\work' }, 'Debian']
  ])('agrees with the launch plan for %s', (_label, spawn, distro) => {
    const args = { cols: 80, rows: 24, ...spawn }
    const getOptions = (): LocalPtyProviderOptions => ({ getWindowsShell: () => 'wsl.exe' })
    expect(resolveLocalPtyWslDistro(args, getOptions)).toBe(distro)
    const plan = createLocalPtyLaunchPlan(args, getOptions)
    expect('launchWslDistro' in plan && plan.launchWslDistro).toBe(distro)
  })

  it('has none for a PowerShell tab', () => {
    const getOptions = (): LocalPtyProviderOptions => ({ getWindowsShell: () => 'powershell.exe' })
    expect(resolveLocalPtyWslDistro({ cols: 80, rows: 24, cwd: 'C:\\work' }, getOptions)).toBe(
      undefined
    )
  })
})
