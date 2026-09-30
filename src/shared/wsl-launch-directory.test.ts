import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LaunchFileUnavailableError, writeSpawnLaunchFile } from './launch-file-writing'
import { buildLaunchFilePointer, planLaunchPrompt, type LaunchFile } from './launch-prompt-file'
import { stageStartupCommand } from './startup-command-staging'
import { parseWslLaunchDirectory, type WslLaunchDirectory } from './wsl-launch-directory'

let windowsSide: string
let directory: WslLaunchDirectory

beforeEach(() => {
  // Stands in for `\\wsl.localhost\Ubuntu\home\ada\.cache\orca`, which only Windows can open.
  windowsSide = join(mkdtempSync(join(tmpdir(), 'orca-wsl-dir-test-')), 'cache')
  directory = { distro: 'Ubuntu', windowsPath: windowsSide, linuxPath: '/home/ada/.cache/orca' }
})

afterEach(() => {
  rmSync(join(windowsSide, '..'), { recursive: true, force: true })
})

function launchFile(content = 'fix the build'): LaunchFile {
  const planned = planLaunchPrompt(content, { sensitive: true })
  return { ...planned.launchFile!, quoting: 'posix' }
}

describe('a WSL launch file', () => {
  it('is written through the Windows side and named by its Linux path in the line', () => {
    const file = launchFile()
    const written = writeSpawnLaunchFile({
      launchFile: file,
      command: `claude '${buildLaunchFilePointer(file.placeholder)}'`,
      orcaBuiltLine: true,
      wslDistro: 'Ubuntu',
      wslDirectory: directory
    })!
    const [created] = readdirSync(windowsSide)
    expect(written.directory).toBe(join(windowsSide, created!))
    expect(readFileSync(join(written.directory, 'task-context.md'), 'utf8')).toBe('fix the build')
    expect(written.path).toBe(`/home/ada/.cache/orca/${created}/task-context.md`)
    expect(written.command).toContain(written.path)
    expect(written.command).not.toContain(windowsSide)
  })

  it("refuses rather than name a Windows path the distro's agent cannot read", () => {
    const write = (wslDirectory: WslLaunchDirectory | undefined) =>
      writeSpawnLaunchFile({
        launchFile: launchFile(),
        command: 'claude',
        orcaBuiltLine: true,
        wslDistro: 'Ubuntu',
        wslDirectory
      })
    expect(() => write(undefined)).toThrow(LaunchFileUnavailableError)
    expect(() => write({ ...directory, distro: 'Debian' })).toThrow(LaunchFileUnavailableError)
    expect(readdirSync(join(windowsSide, '..'))).toEqual([])
  })

  it('refuses a long agent line it would otherwise type raw, and types a short one', () => {
    const line = (command: string) => () =>
      writeSpawnLaunchFile({
        command,
        orcaBuiltLine: true,
        wslDistro: 'Ubuntu',
        wslDirectory: undefined
      })
    expect(line(`claude '${'x'.repeat(600)}'`)).toThrow(LaunchFileUnavailableError)
    expect(line(`claude 'one\ntwo'`)).toThrow(LaunchFileUnavailableError)
    expect(line(`claude 'fix it'`)()).toBeUndefined()
  })
})

describe('a WSL staged line', () => {
  it('writes the script through the Windows side and runs it by its Linux path', () => {
    const command = `claude '${'x'.repeat(600)}'`
    const staging = stageStartupCommand({
      command,
      shellPath: 'C:\\Windows\\System32\\wsl.exe',
      orcaBuiltLine: true,
      platform: 'win32',
      wslDirectory: directory
    })
    const [script] = readdirSync(windowsSide)
    expect(staging).toMatchObject({ delivery: 'staged', scriptPath: join(windowsSide, script!) })
    // The host cannot see the distro's shell, so `/bin/sh` runs it whatever that shell is.
    expect(staging.command).toBe(`/bin/sh '/home/ada/.cache/orca/${script}'`)
    expect(readFileSync(join(windowsSide, script!), 'utf8')).toBe(
      `command rm -f -- '/home/ada/.cache/orca/${script}'\n${command}\n`
    )
  })
})

describe('parseWslLaunchDirectory', () => {
  it('accepts a UNC and Linux pair and rejects anything else', () => {
    const valid = {
      distro: 'Ubuntu',
      windowsPath: '\\\\wsl.localhost\\Ubuntu\\home\\ada\\.cache\\orca',
      linuxPath: '/home/ada/.cache/orca'
    }
    expect(parseWslLaunchDirectory(valid)).toEqual(valid)
    expect(parseWslLaunchDirectory({ ...valid, windowsPath: 'C:\\Users\\ada' })).toBeUndefined()
    expect(parseWslLaunchDirectory({ ...valid, linuxPath: 'home/ada' })).toBeUndefined()
    expect(parseWslLaunchDirectory({ distro: 'Ubuntu' })).toBeUndefined()
    expect(parseWslLaunchDirectory(null)).toBeUndefined()
  })
})
