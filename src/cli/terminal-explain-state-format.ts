import type { RuntimeTerminalStateExplanation } from '../shared/terminal-state-explanation'

const SCREEN_PREVIEW_ROWS = 6

function formatState(explanation: RuntimeTerminalStateExplanation): string {
  if (explanation.blockedReason) {
    return `${explanation.state} (${explanation.blockedReason})`
  }
  if (explanation.quietForeground) {
    return `${explanation.state} (quiet foreground: ${explanation.quietForeground})`
  }
  return explanation.state
}

function formatAnswer(
  answer: RuntimeTerminalStateExplanation['rules']['evaluated'][number]['answer']
): string {
  const strength = answer.strength ? ` ${answer.strength}` : ''
  const quiet = answer.requiresQuiet ? ', once quiet' : ''
  return `${answer.state}${strength}${quiet}`
}

function formatRegions(regions: RuntimeTerminalStateExplanation['rules']['regions']): string[] {
  const screen = regions.screen
    ? regions.screen
        .slice(-SCREEN_PREVIEW_ROWS)
        .map((row) => `    | ${row}`)
        .join('\n')
    : '    (unreadable)'
  const text = regions.textTail === null ? '(unreadable)' : JSON.stringify(regions.textTail)
  return [
    `  title status: ${regions.title ?? '(none)'}`,
    `  screen (last ${SCREEN_PREVIEW_ROWS} rows):`,
    screen,
    `  text tail: ${text}`
  ]
}

export function formatTerminalExplainState(result: {
  explanation: RuntimeTerminalStateExplanation
}): string {
  const { explanation } = result
  const { rules } = explanation
  const deciding = rules.deciding
    ? `${rules.deciding.ruleId} (${rules.deciding.region})`
    : 'none (the other readiness lanes decide)'
  const evaluated =
    rules.evaluated.length === 0
      ? ['  (this rule file has no rules)']
      : rules.evaluated.map(
          (rule) =>
            `  ${rule.outcome.padEnd(21)} ${rule.ruleId} [${rule.region}, priority ${rule.priority}] -> ${formatAnswer(rule.answer)}`
        )
  return [
    `handle: ${explanation.handle}`,
    `agent: ${explanation.agent ?? 'unknown'}`,
    `state: ${formatState(explanation)}`,
    `deciding rule: ${deciding}`,
    `rules file: ${rules.rulesFile}`,
    `rules version: ${explanation.rulesVersion} (${explanation.rulesSource})`,
    `last update error: ${explanation.lastUpdateError ?? 'none'}`,
    'evaluated rules:',
    ...evaluated,
    'regions:',
    ...formatRegions(rules.regions)
  ].join('\n')
}
