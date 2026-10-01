import { describe, expect, it, vi } from 'vitest'
import { createTranscriptPane } from './agent-transcript-pane-test-harness'
import { BUNDLED_AGENT_STATE_RULES_VERSION } from './agent-state-rules/agent-state-rules-bundle'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

describe('runtime.explainTerminalState', () => {
  it('explains a pane with the verdict a tui-idle wait ranks and its agent rules', async () => {
    const { runtime, handle } = await createTranscriptPane({
      paneTitle: 'claude',
      foregroundProcess: 'claude',
      data: 'Do you trust the files in this folder?\r\n',
      launchAgent: 'claude'
    })
    const explanation = runtime.explainTerminalState(handle)
    expect(explanation).toMatchObject({
      handle,
      agent: 'claude',
      state: 'blocked',
      blockedReason: 'agent-trust-workspace',
      rules: { rulesFile: 'claude' },
      rulesVersion: BUNDLED_AGENT_STATE_RULES_VERSION,
      rulesSource: 'bundled',
      lastUpdateError: null
    })
    expect(explanation.rules.evaluated.map((rule) => rule.ruleId)).toEqual(['idle_title'])
    expect(explanation.rules.regions.textTail).toContain('do you trust the files')
  })

  it('refuses a handle the runtime does not know', async () => {
    const { runtime } = await createTranscriptPane({
      paneTitle: 'zsh',
      foregroundProcess: null,
      data: ''
    })
    expect(() => runtime.explainTerminalState('term_missing')).toThrow()
  })
})
