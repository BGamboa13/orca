import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTerminalTailSentinelMatches } from '../terminal-tail-sentinel-index'
import {
  activateAgentStateRules,
  bundledAgentStateRules,
  getActiveAgentStateRules,
  getAgentStateRulesStatus,
  setAgentStateRulesUpdateError
} from './active-agent-state-rules'
import { BUNDLED_AGENT_STATE_RULES_VERSION } from './agent-state-rules-bundle'
import { BUNDLED_AGENT_STATE_RULE_FILES } from './agent-state-rules-catalog'
import { idleTitleRequiresQuiet } from './agent-state-rules-engine'
import {
  AGENT_STATE_RULES_FILE_NAME,
  AgentStateRulesLiveUpdater,
  agentStateRulesChannelForAppVersion,
  agentStateRulesDownloadUrl,
  type AgentStateRulesLiveUpdateDeps
} from './agent-state-rules-live-update'
import { showsIdleTitleAnchor } from './agent-state-title-anchors'

const NEWER = '9999.1.1.1'
const NEWEST = '9999.1.1.2'

function bundledFile(id: string): Record<string, unknown> {
  const file = BUNDLED_AGENT_STATE_RULE_FILES.find((candidate) => candidate.id === id)
  if (!file) {
    throw new Error(`no bundled ${id}`)
  }
  return structuredClone(file)
}

// A Claude file whose title rule settles without quiet: visible through idleTitleRequiresQuiet.
function claudeWithoutQuiet(): Record<string, unknown> {
  const claude = bundledFile('claude')
  return {
    ...claude,
    rules: [
      {
        id: 'idle_title',
        why: 'test',
        priority: 100,
        when: { region: 'title', status: 'idle' },
        answer: { state: 'idle', strength: 'weak', requiresQuiet: false }
      }
    ]
  }
}

function bundleText(
  version: string,
  files: unknown[] = [claudeWithoutQuiet()],
  extra: Record<string, unknown> = {}
): string {
  return JSON.stringify({ version, engineVersion: 1, ...extra, files })
}

type Harness = {
  updater: AgentStateRulesLiveUpdater
  userData: string
  settings: { agentStateRulesPath?: string | null; agentStateRulesLiveUpdates?: boolean }
  env: NodeJS.ProcessEnv
  fetch: ReturnType<typeof vi.fn>
  onActivated: ReturnType<typeof vi.fn>
}

let userData: string

function harness(overrides: Partial<AgentStateRulesLiveUpdateDeps> = {}): Harness {
  const settings: Harness['settings'] = {}
  const env: NodeJS.ProcessEnv = {}
  const fetch = vi.fn(async () => new Response('Not Found', { status: 404 }))
  const onActivated = vi.fn()
  const updater = new AgentStateRulesLiveUpdater({
    userDataPath: userData,
    appVersion: '1.4.0',
    isPackaged: true,
    fetch,
    readSettings: () => settings,
    env,
    onActivated,
    ...overrides
  })
  return { updater, userData, settings, env, fetch, onActivated }
}

function serve(h: Harness, text: string): void {
  h.fetch.mockImplementation(async () => new Response(text, { status: 200 }))
}

function writeCache(text: string): void {
  writeFileSync(join(userData, AGENT_STATE_RULES_FILE_NAME), text)
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'agent-state-rules-live-update-'))
})

afterEach(() => {
  activateAgentStateRules(bundledAgentStateRules())
  setAgentStateRulesUpdateError(null)
  rmSync(userData, { recursive: true, force: true })
})

describe('agent state rules channel and URL', () => {
  it.each([
    ['1.4.0', 'stable'],
    ['1.4.1-rc.2', 'next'],
    ['1.4.1-rc.2.perf', 'next'],
    ['not-a-version', null]
  ])('maps app version %s to %s', (version, channel) => {
    expect(agentStateRulesChannelForAppVersion(version)).toBe(channel)
  })

  it('fetches the fixed release-download URL for the engine and channel', () => {
    expect(agentStateRulesDownloadUrl('next')).toBe(
      'https://github.com/stablyai/orca/releases/download/agent-state-rules-engine-1-next/agent-state-rules.json'
    )
  })
})

describe('agent state rules live updates', () => {
  it('starts on the bundled rules and fetches the stable tag for a stable app', async () => {
    const h = harness()
    await h.updater.start()
    expect(h.fetch).toHaveBeenCalledWith(agentStateRulesDownloadUrl('stable'), expect.anything())
    expect(getAgentStateRulesStatus()).toEqual({
      version: BUNDLED_AGENT_STATE_RULES_VERSION,
      source: 'bundled',
      lastUpdateError: 'download failed: HTTP 404'
    })
    h.updater.stop()
  })

  it('accepts a newer download, writes it atomically, and hot-reloads the engine', async () => {
    const h = harness({ appVersion: '1.4.1-rc.0' })
    expect(idleTitleRequiresQuiet('claude')).toBe(true)
    const text = bundleText(NEWER)
    serve(h, text)
    await h.updater.start()
    expect(h.fetch).toHaveBeenCalledWith(agentStateRulesDownloadUrl('next'), expect.anything())
    expect(getAgentStateRulesStatus()).toEqual({
      version: NEWER,
      source: 'downloaded',
      lastUpdateError: null
    })
    expect(idleTitleRequiresQuiet('claude')).toBe(false)
    expect(readFileSync(join(userData, AGENT_STATE_RULES_FILE_NAME), 'utf8')).toBe(text)
    expect(readdirSync(userData)).toEqual([AGENT_STATE_RULES_FILE_NAME])
    expect(h.onActivated).toHaveBeenCalledWith({ version: NEWER, source: 'downloaded' })
    h.updater.stop()
  })

  it('keeps every agent the download does not carry on its bundled file', async () => {
    const h = harness()
    serve(h, bundleText(NEWER))
    await h.updater.start()
    const active = getActiveAgentStateRules()
    expect(active.files.map((file) => file.id)).toEqual(
      BUNDLED_AGENT_STATE_RULE_FILES.map((file) => file.id)
    )
    expect(active.files.find((file) => file.id === 'gemini')).toBe(
      BUNDLED_AGENT_STATE_RULE_FILES.find((file) => file.id === 'gemini')
    )
    h.updater.stop()
  })

  it.each([
    ['not newer than the bundled copy', bundleText(BUNDLED_AGENT_STATE_RULES_VERSION), null],
    ['older than the bundled copy', bundleText('2000.1.1.1'), null],
    [
      'built for another engine',
      JSON.stringify({ version: NEWER, engineVersion: 2, files: [] }),
      'download rejected: built for rules engine 2; this build runs engine 1'
    ],
    [
      'carrying an agent with no transcript suite',
      bundleText(NEWER, [bundledFile('gemini')]),
      'download rejected: carries gemini, which has no transcript suite to gate it'
    ],
    [
      'an unsafe pattern',
      bundleText(NEWER, [
        {
          ...bundledFile('claude'),
          anchors: [
            {
              id: 'bad',
              why: 'test',
              when: { region: 'title', status: 'idle', match: { regex: '(a+)+$' } },
              answer: { state: 'idle' }
            }
          ]
        }
      ]),
      'repeats a group'
    ],
    ['not JSON', '{', 'download rejected: not JSON'],
    [
      'over the size cap',
      ' '.repeat(256 * 1024 + 1),
      'download failed: Response body exceeds 262144 byte limit'
    ]
  ])('refuses a download %s and keeps the bundled rules', async (_label, text, error) => {
    const h = harness()
    serve(h, text)
    await h.updater.start()
    const status = getAgentStateRulesStatus()
    expect(status.source).toBe('bundled')
    expect(status.version).toBe(BUNDLED_AGENT_STATE_RULES_VERSION)
    if (error === null) {
      expect(status.lastUpdateError).toBeNull()
    } else {
      expect(status.lastUpdateError).toContain(error)
    }
    expect(readdirSync(userData)).toEqual([])
    h.updater.stop()
  })

  it('keeps the last good copy through a 404, a network error and an older download', async () => {
    const h = harness()
    serve(h, bundleText(NEWEST))
    await h.updater.start()
    h.fetch.mockImplementation(async () => new Response('Not Found', { status: 404 }))
    await h.updater.refresh()
    expect(getAgentStateRulesStatus()).toMatchObject({ version: NEWEST, source: 'downloaded' })
    h.fetch.mockImplementation(async () => {
      throw new Error('offline')
    })
    await h.updater.refresh()
    expect(getAgentStateRulesStatus()).toMatchObject({
      version: NEWEST,
      lastUpdateError: 'download failed: offline'
    })
    serve(h, bundleText(NEWER))
    await h.updater.refresh()
    expect(getAgentStateRulesStatus()).toEqual({
      version: NEWEST,
      source: 'downloaded',
      lastUpdateError: null
    })
    expect(
      JSON.parse(readFileSync(join(userData, AGENT_STATE_RULES_FILE_NAME), 'utf8'))
    ).toMatchObject({ version: NEWEST })
    h.updater.stop()
  })

  it('activates a cached download newer than the bundled rules before any fetch lands', async () => {
    writeCache(bundleText(NEWER))
    const h = harness()
    h.fetch.mockImplementation(() => new Promise<Response>(() => {}))
    void h.updater.start()
    await vi.waitFor(() => expect(getAgentStateRulesStatus().source).toBe('downloaded'))
    expect(getAgentStateRulesStatus().version).toBe(NEWER)
    h.updater.stop()
  })

  it('ignores a cached download that is not newer than the bundled rules', async () => {
    writeCache(bundleText('2000.1.1.1'))
    const h = harness()
    await h.updater.start()
    expect(getAgentStateRulesStatus().source).toBe('bundled')
    h.updater.stop()
  })

  it('refuses a download no newer than the cached one', async () => {
    writeCache(bundleText(NEWEST))
    const h = harness()
    serve(h, bundleText(NEWER, [bundledFile('claude')]))
    await h.updater.start()
    expect(getAgentStateRulesStatus()).toMatchObject({ version: NEWEST, source: 'downloaded' })
    expect(idleTitleRequiresQuiet('claude')).toBe(false)
    h.updater.stop()
  })

  it('falls back to the bundled rules when a published bundle says bundledOnly', async () => {
    const h = harness()
    serve(h, bundleText(NEWER))
    await h.updater.start()
    serve(h, bundleText(NEWEST, [claudeWithoutQuiet()], { bundledOnly: true }))
    await h.updater.refresh()
    expect(getAgentStateRulesStatus()).toMatchObject({ source: 'bundled' })
    expect(idleTitleRequiresQuiet('claude')).toBe(true)
    h.updater.stop()
  })

  it.each([
    ['the setting', (h: Harness) => (h.settings.agentStateRulesLiveUpdates = false)],
    ['the env', (h: Harness) => (h.env.ORCA_DISABLE_AGENT_STATE_RULES_UPDATES = '1')]
  ])('uses only the bundled rules when %s turns live updates off', async (_label, disable) => {
    writeCache(bundleText(NEWER))
    const h = harness()
    disable(h)
    await h.updater.start()
    expect(h.fetch).not.toHaveBeenCalled()
    expect(getAgentStateRulesStatus().source).toBe('bundled')
    h.updater.stop()
  })

  it('never fetches from an unpackaged build', async () => {
    const h = harness({ isPackaged: false })
    await h.updater.start()
    expect(h.fetch).not.toHaveBeenCalled()
    h.updater.stop()
  })

  it('ranks a local override over a download over the bundled rules', async () => {
    const overridePath = join(userData, 'override.json')
    // Why gemini: the override may carry an agent a rules release cannot.
    writeFileSync(overridePath, bundleText('1.0', [bundledFile('gemini')]))
    writeCache(bundleText(NEWER))
    const h = harness()
    h.settings.agentStateRulesPath = overridePath
    await h.updater.start()
    expect(getAgentStateRulesStatus()).toMatchObject({ version: '1.0', source: 'override' })

    h.settings.agentStateRulesPath = null
    await h.updater.start()
    expect(getAgentStateRulesStatus()).toMatchObject({ version: NEWER, source: 'downloaded' })

    h.env.ORCA_AGENT_STATE_RULES_PATH = overridePath
    await h.updater.start()
    expect(getAgentStateRulesStatus()).toMatchObject({ source: 'override' })
    h.updater.stop()
  })

  it('reports a rejected override and keeps the next source in line', async () => {
    const overridePath = join(userData, 'override.json')
    writeFileSync(overridePath, '{"version":"1","engineVersion":1,"files":[{"id":"claude"}]}')
    const h = harness()
    h.settings.agentStateRulesPath = overridePath
    await h.updater.start()
    expect(getAgentStateRulesStatus().source).toBe('bundled')
    expect(h.onActivated).not.toHaveBeenCalled()
    h.updater.stop()
  })

  it('still activates an accepted download when the cache cannot be written', async () => {
    const h = harness({ userDataPath: join(userData, 'missing', 'dir') })
    serve(h, bundleText(NEWER))
    await h.updater.start()
    expect(getAgentStateRulesStatus().source).toBe('downloaded')
    expect(getAgentStateRulesStatus().lastUpdateError).toContain('downloaded rules not cached')
    h.updater.stop()
  })
})

describe('agent state rules hot reload', () => {
  it('recompiles the title anchors every pane reads', () => {
    expect(showsIdleTitleAnchor('✳ Claude Code', 'idle')).toBe(true)
    activateAgentStateRules({
      ...bundledAgentStateRules(),
      files: bundledAgentStateRules().files.map((file) =>
        file.id === 'claude' ? { ...file, anchors: [] } : file
      )
    })
    expect(showsIdleTitleAnchor('✳ Claude Code', 'idle')).toBe(false)
  })

  it('rescans a tail the sentinel index already covered when a blocked anchor arrives', () => {
    const lines = ['zebra crossing prompt']
    expect(getTerminalTailSentinelMatches(lines)).toEqual([])
    activateAgentStateRules({
      ...bundledAgentStateRules(),
      files: bundledAgentStateRules().files.map((file) =>
        file.id === 'claude'
          ? {
              ...file,
              anchors: [
                ...file.anchors,
                {
                  id: 'zebra',
                  why: 'test',
                  when: { region: 'text', find: { lastOf: 'zebra crossing' } },
                  answer: { state: 'blocked', reason: 'agent-approval-prompt' }
                }
              ]
            }
          : file
      )
    })
    expect(getTerminalTailSentinelMatches(lines)).toEqual([0])
  })
})
