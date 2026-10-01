import { describe, expect, it } from 'vitest'
import { formatTerminalExplainState } from './terminal-explain-state-format'

describe('formatTerminalExplainState', () => {
  it('prints the state, the deciding rule, each evaluated rule, and the rules source', () => {
    const text = formatTerminalExplainState({
      explanation: {
        handle: 'term_1',
        agent: 'codex',
        state: 'pending',
        quietForeground: 'closed',
        rules: {
          rulesFile: 'codex',
          deciding: { ruleId: 'idle_title', region: 'title' },
          evaluated: [
            {
              ruleId: 'idle_title',
              region: 'title',
              priority: 100,
              answer: { state: 'idle', strength: 'weak', requiresQuiet: true },
              outcome: 'matched'
            }
          ],
          regions: { screen: null, title: 'idle', textTail: 'done' }
        },
        rulesVersion: '2026.10.01.1',
        rulesSource: 'downloaded',
        lastUpdateError: 'download failed: HTTP 404'
      }
    })
    expect(text).toContain('state: pending (quiet foreground: closed)')
    expect(text).toContain('deciding rule: idle_title (title)')
    expect(text).toContain(
      'matched               idle_title [title, priority 100] -> idle weak, once quiet'
    )
    expect(text).toContain('rules version: 2026.10.01.1 (downloaded)')
    expect(text).toContain('last update error: download failed: HTTP 404')
    expect(text).toContain('    (unreadable)')
  })

  it('prints a state or outcome this build has never heard of as it came', () => {
    const text = formatTerminalExplainState({
      explanation: {
        handle: 'term_1',
        agent: null,
        state: 'some-new-state',
        rules: {
          rulesFile: 'unknown-pane',
          deciding: null,
          evaluated: [],
          regions: { screen: [], title: null, textTail: null }
        },
        rulesVersion: '1',
        rulesSource: 'bundled',
        lastUpdateError: null
      }
    })
    expect(text).toContain('state: some-new-state')
    expect(text).toContain('deciding rule: none')
    expect(text).toContain('(this rule file has no rules)')
  })
})
