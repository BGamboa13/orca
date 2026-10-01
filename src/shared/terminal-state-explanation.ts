/**
 * `terminal.explainState`: why the host reads a terminal as ready, working or blocked. Every enum
 * is a plain string on the wire: a newer host may add states, regions or outcomes, and the CLI
 * prints them as it gets them.
 */
export type RuntimeTerminalStateExplanation = {
  handle: string
  agent: string | null
  /** The ranked tui-idle verdict: blocked, ready-strong, ready-weak, working or pending. */
  state: string
  blockedReason?: string
  /** For a pending verdict: whether a quiet foreground process may still settle it. */
  quietForeground?: string
  rules: {
    /** The rule file read: the pane's agent, or `unknown-pane`. */
    rulesFile: string
    deciding: { ruleId: string; region: string } | null
    evaluated: {
      ruleId: string
      region: string
      priority: number
      answer: { state: string; strength?: string; requiresQuiet?: boolean }
      /** matched, not-matched, unreadable (its region had no trustworthy copy), or skipped-without-clock. */
      outcome: string
    }[]
    regions: { screen: readonly string[] | null; title: string | null; textTail: string | null }
  }
  rulesVersion: string
  /** bundled, downloaded or override. */
  rulesSource: string
  lastUpdateError: string | null
}
