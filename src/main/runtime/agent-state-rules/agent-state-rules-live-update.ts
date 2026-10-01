import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-environment'
import { readFetchResponseTextWithinLimit } from '../../../shared/fetch-response-body'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { getVersionChannel, MAIN_RELEASE_REPO } from '../../../shared/release-channel'
import { getMainHttpClient } from '../../network/http-client'
import { writePluginFileAtomically } from '../../plugins/plugin-atomic-file-write'
import {
  activateAgentStateRules,
  bundledAgentStateRules,
  getActiveAgentStateRules,
  overlayOnBundledAgentStateRules,
  setAgentStateRulesUpdateError,
  type ActiveAgentStateRules
} from './active-agent-state-rules'
import {
  AGENT_STATE_RULES_BUNDLE_MAX_BYTES,
  BUNDLED_AGENT_STATE_RULES_VERSION,
  compareAgentStateRulesVersions,
  parseAgentStateRulesBundle,
  type AgentStateRulesBundle
} from './agent-state-rules-bundle'
import { AGENT_STATE_RULES_ENGINE_VERSION } from './agent-state-rules-schema'

/** The published asset and the cached copy in userData share one name. */
export const AGENT_STATE_RULES_FILE_NAME = 'agent-state-rules.json'

const DEFAULT_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 30_000

export type AgentStateRulesChannel = 'next' | 'stable'

/** Stable apps read the stable tag; RC, hourly, daily and adhoc builds soak the next one first. */
export function agentStateRulesChannelForAppVersion(
  appVersion: string
): AgentStateRulesChannel | null {
  const channel = getVersionChannel(appVersion)
  if (!channel) {
    return null
  }
  return channel === 'stable' ? 'stable' : 'next'
}

// Why a fixed release-download URL: no API call or rate limit, and no "latest" lookup to steer.
export function agentStateRulesDownloadUrl(channel: AgentStateRulesChannel): string {
  const tag = `agent-state-rules-engine-${AGENT_STATE_RULES_ENGINE_VERSION}-${channel}`
  return `https://github.com/${MAIN_RELEASE_REPO}/releases/download/${tag}/${AGENT_STATE_RULES_FILE_NAME}`
}

type LiveUpdateSettings = Pick<GlobalSettings, 'agentStateRulesPath' | 'agentStateRulesLiveUpdates'>

export type AgentStateRulesLiveUpdateDeps = {
  userDataPath: string
  appVersion: string
  /** Unpackaged dev and test runs never download. */
  isPackaged: boolean
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  readSettings: () => LiveUpdateSettings | null | undefined
  env: NodeJS.ProcessEnv
  /** Called when the active version or source changes, for diagnostics and crash reports. */
  onActivated: (rules: { version: string; source: string }) => void
  refreshIntervalMs?: number
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * Keeps the active agent state rules current: a local override, else a downloaded copy newer than
 * the bundled one, else the bundled rules. Any failure keeps the last good copy active.
 */
export class AgentStateRulesLiveUpdater {
  private downloaded: AgentStateRulesBundle | null = null
  private override: AgentStateRulesBundle | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<void> | null = null
  // Why: a settings change restarts while an earlier start may still be reading files.
  private startGeneration = 0

  constructor(private readonly deps: AgentStateRulesLiveUpdateDeps) {}

  /** Loads the override and the cached download, then fetches now and on an interval. Re-run it
   *  when the settings it reads change. */
  async start(): Promise<void> {
    this.stop()
    const generation = ++this.startGeneration
    await this.loadOverride()
    const cached = this.liveUpdatesEnabled() ? await this.readCachedDownload() : null
    if (generation !== this.startGeneration) {
      return
    }
    this.downloaded = cached
    this.activate()
    if (!this.liveUpdatesEnabled() || !this.channel()) {
      return
    }
    this.timer = setInterval(
      () => void this.refresh(),
      this.deps.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS
    )
    this.timer.unref?.()
    await this.refresh()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  refresh(): Promise<void> {
    this.inFlight ??= this.downloadAndAccept().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private channel(): AgentStateRulesChannel | null {
    return agentStateRulesChannelForAppVersion(this.deps.appVersion)
  }

  private liveUpdatesEnabled(): boolean {
    return (
      this.deps.isPackaged &&
      this.deps.env.ORCA_DISABLE_AGENT_STATE_RULES_UPDATES !== '1' &&
      this.deps.readSettings()?.agentStateRulesLiveUpdates !== false
    )
  }

  private cachePath(): string {
    return join(this.deps.userDataPath, AGENT_STATE_RULES_FILE_NAME)
  }

  private recordError(error: string | null): void {
    setAgentStateRulesUpdateError(error)
    if (error) {
      console.warn(`[agent-state-rules] ${error}`)
    }
  }

  private async loadOverride(): Promise<void> {
    this.override = null
    const path =
      this.deps.env.ORCA_AGENT_STATE_RULES_PATH || this.deps.readSettings()?.agentStateRulesPath
    if (!path) {
      return
    }
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      this.recordError(`override ${path} unreadable: ${describeError(error)}`)
      return
    }
    // Why any agent: the user chose this file, so the transcript gate on releases does not apply.
    const parsed = parseAgentStateRulesBundle(text, 'any-agent')
    if (!parsed.ok) {
      this.recordError(`override ${path} rejected: ${parsed.error}`)
      return
    }
    this.override = parsed.bundle
  }

  private async readCachedDownload(): Promise<AgentStateRulesBundle | null> {
    let text: string
    try {
      text = await readFile(this.cachePath(), 'utf8')
    } catch (error) {
      if (!isMissingFile(error)) {
        this.recordError(`cached rules unreadable: ${describeError(error)}`)
      }
      return null
    }
    // Why re-validate: the cache may come from an older build with another engine or schema.
    const parsed = parseAgentStateRulesBundle(text, 'live-updatable')
    if (!parsed.ok) {
      this.recordError(`cached rules rejected: ${parsed.error}`)
      return null
    }
    return parsed.bundle
  }

  private async downloadAndAccept(): Promise<void> {
    const channel = this.channel()
    if (!channel || !this.liveUpdatesEnabled()) {
      return
    }
    let text: string
    try {
      const response = await this.deps.fetch(agentStateRulesDownloadUrl(channel), {
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        // Why not fatal: a 404 is also what a re-upload in progress looks like.
        this.recordError(`download failed: HTTP ${response.status}`)
        return
      }
      text = await readFetchResponseTextWithinLimit(response, AGENT_STATE_RULES_BUNDLE_MAX_BYTES)
    } catch (error) {
      this.recordError(`download failed: ${describeError(error)}`)
      return
    }
    const parsed = parseAgentStateRulesBundle(text, 'live-updatable')
    if (!parsed.ok) {
      this.recordError(`download rejected: ${parsed.error}`)
      return
    }
    // Why newer than both: an app whose bundled rules already hold a fix must not be shadowed
    // by an older download, and a cached copy must never be replaced by an older one.
    const floors = [BUNDLED_AGENT_STATE_RULES_VERSION, this.downloaded?.version ?? '0']
    if (floors.some((floor) => compareAgentStateRulesVersions(parsed.bundle.version, floor) <= 0)) {
      this.recordError(null)
      return
    }
    this.downloaded = parsed.bundle
    this.activate()
    try {
      await writePluginFileAtomically(this.cachePath(), text)
      this.recordError(null)
    } catch (error) {
      this.recordError(`downloaded rules not cached: ${describeError(error)}`)
    }
  }

  private resolveActive(): ActiveAgentStateRules {
    if (this.override) {
      return {
        files: overlayOnBundledAgentStateRules(this.override.files),
        version: this.override.version,
        source: 'override'
      }
    }
    const downloaded = this.downloaded
    if (
      downloaded &&
      !downloaded.bundledOnly &&
      this.liveUpdatesEnabled() &&
      compareAgentStateRulesVersions(downloaded.version, BUNDLED_AGENT_STATE_RULES_VERSION) > 0
    ) {
      return {
        files: overlayOnBundledAgentStateRules(downloaded.files),
        version: downloaded.version,
        source: 'downloaded'
      }
    }
    return bundledAgentStateRules()
  }

  private activate(): void {
    const previous = getActiveAgentStateRules()
    const next = this.resolveActive()
    activateAgentStateRules(next)
    if (previous.version !== next.version || previous.source !== next.source) {
      this.deps.onActivated({ version: next.version, source: next.source })
    }
  }
}

/**
 * Starts live updates on this host: the desktop, `orca serve` and orcad each fetch their own copy,
 * so a paired client never supplies the rules a host evaluates with.
 */
export function startAgentStateRulesLiveUpdates(options: {
  readSettings: () => LiveUpdateSettings | null | undefined
  onSettingsChanged?: (listener: (updates: Partial<GlobalSettings>) => void) => void
  onActivated: AgentStateRulesLiveUpdateDeps['onActivated']
}): AgentStateRulesLiveUpdater {
  const environment = getAppEnvironment()
  const updater = new AgentStateRulesLiveUpdater({
    userDataPath: environment.getPath('userData'),
    appVersion: environment.getVersion(),
    isPackaged: environment.isPackaged(),
    fetch: (url, init) => getMainHttpClient().fetch(url, init),
    readSettings: options.readSettings,
    env: process.env,
    onActivated: options.onActivated
  })
  void updater.start()
  options.onSettingsChanged?.((updates) => {
    if ('agentStateRulesPath' in updates || 'agentStateRulesLiveUpdates' in updates) {
      void updater.start()
    }
  })
  environment.onWillQuit(() => updater.stop())
  return updater
}
