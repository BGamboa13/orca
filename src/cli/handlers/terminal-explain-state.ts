import type { RuntimeTerminalStateExplanation } from '../../shared/terminal-state-explanation'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { getTerminalHandle } from '../selectors'
import { formatTerminalExplainState } from '../terminal-explain-state-format'

export const terminalExplainStateHandler: CommandHandler = async ({ flags, client, cwd, json }) => {
  const terminal = await getTerminalHandle(flags, cwd, client)
  try {
    const result = await client.call<{ explanation: RuntimeTerminalStateExplanation }>(
      'terminal.explainState',
      { terminal }
    )
    printResult(result, json, formatTerminalExplainState)
  } catch (error) {
    // Why: a host older than this command answers method_not_found, which reads like a typo.
    if (error instanceof RuntimeClientError && error.code === 'method_not_found') {
      throw new RuntimeClientError(
        'incompatible_runtime',
        'This Orca host cannot explain terminal state yet. Update Orca on the host and try again.'
      )
    }
    throw error
  }
}
