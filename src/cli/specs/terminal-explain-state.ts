import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const TERMINAL_EXPLAIN_STATE_COMMAND_SPEC: CommandSpec = {
  path: ['terminal', 'explain-state'],
  summary: 'Explain why a terminal reads as ready, working or blocked',
  usage: 'orca terminal explain-state [<handle>] [--terminal <handle>] [--json]',
  allowedFlags: [...GLOBAL_FLAGS, 'terminal'],
  positionalArgs: ['terminal'],
  notes: [
    'Prints the detected state, the agent state rule that decided it, every rule evaluated with its outcome, the region previews they read, the rules version and source, and the last rules update error.'
  ],
  examples: ['orca terminal explain-state term_abc123', 'orca terminal explain-state --json']
}
