import { describe, expect, it } from 'vitest'
import { evaluateAgentStateRules, explainAgentStateRules } from './agent-state-rules-engine'

describe('explainAgentStateRules', () => {
  it('reports every rule in priority order and the one that decided', () => {
    const regions = {
      readScreenLines: () => ['some output', '› '],
      readText: () => 'some output',
      readTitleStatus: () => 'idle' as const,
      hasOutputClock: false
    }
    const explanation = explainAgentStateRules('codex', regions)
    expect(explanation.rulesFile).toBe('codex')
    expect(explanation.rules.map((rule) => [rule.ruleId, rule.outcome])).toEqual([
      ['header_ready', 'not-matched'],
      ['composer_ready', 'skipped-without-clock'],
      ['text_header_ready', 'not-matched'],
      ['idle_title', 'matched']
    ])
    expect(explanation.deciding).toEqual({ ruleId: 'idle_title', region: 'title' })
    expect(explanation.deciding?.ruleId).toBe(evaluateAgentStateRules('codex', regions)?.ruleId)
    expect(explanation.regions).toEqual({
      screen: ['some output', '› '],
      title: 'idle',
      textTail: 'some output'
    })
  })

  it('marks a rule whose region has no trustworthy copy unreadable', () => {
    const explanation = explainAgentStateRules('claude', {})
    expect(explanation.rules).toEqual([
      {
        ruleId: 'idle_title',
        region: 'title',
        priority: 100,
        answer: { state: 'idle', strength: 'weak', requiresQuiet: true },
        outcome: 'unreadable'
      }
    ])
    expect(explanation.deciding).toBeNull()
  })

  it('reads the unknown-pane file for a pane with no known agent', () => {
    expect(explainAgentStateRules(null, {}).rulesFile).toBe('unknown-pane')
  })
})
