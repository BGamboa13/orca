import type { RuntimeTerminalSend } from '../../../../../../shared/runtime-terminal-contracts'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../orchestration/db'
import {
  buildDispatchPreamble,
  dispatchPreambleSendOptions
} from '../../../../orchestration/preamble'
import {
  ORCA_SESSION_ADDRESS_PREFIX,
  parseOrcaSessionAddress
} from '../../../../../../shared/orca-session-address'
import { agentVisibleOrchestrationAddress } from '../../../../orchestration/structured-session-mail-address'
import { sendStructuredWorkerPreamble } from '../../orchestration-structured-worker-session'
import type { WorkerTurnStartObservation } from './worker-start-turn-observation'
import type { createStructuredWorkerSessionForWorktree } from './worker-topology'
import { queueDispatchPreambleTurn } from '../../../../orchestration/dispatch-preamble-turn'

type StructuredSession = Awaited<ReturnType<typeof createStructuredWorkerSessionForWorktree>> | null

/** What the delivery left to observe: a PTY write's receipt, a structured send's own evidence, or a
 *  chat's owed preamble turn. */
export type WorkerPreambleDelivery = {
  prompt?: RuntimeTerminalSend['prompt']
  /** A structured worker's preamble send is its own evidence: acknowledged, or still held. */
  structuredTurnStart?: WorkerTurnStartObservation
  preambleTurnMessageId?: string
}

/**
 * Hands a started worker the dispatch preamble, over whichever transport it has.
 *
 * The preamble itself is identical for all: a worker is taught the same verbs whichever mode it
 * runs in, and only the delivery differs — a PTY write returns a queued/accepted receipt, a
 * structured turn is acknowledged, still held for an agent that has not started, or throws, and a
 * chat is owed it as a turn its mail lane delivers once the chat can take one. Held is a turn start
 * nobody observed yet: the start is left unknown, not torn down.
 */
export async function deliverWorkerDispatchPreamble(args: {
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  structuredSession: StructuredSession
  terminalHandle: string
  dispatchId: string
  dispatchDepth: number
  taskId: string
  taskSpec: string
  coordinatorHandle: string
  dispatchCapability: string
  devMode: boolean | undefined
  requestId: string
  runId: string
}): Promise<WorkerPreambleDelivery> {
  const { runtime, structuredSession, terminalHandle } = args
  const preamble = buildDispatchPreamble({
    // Depth only. A worker is taught the same verbs whichever mode it runs in, so this must not
    // become a second gate: resolving the caller's worktree is what lets a structured worker
    // dispatch sub-workers exactly like a PTY one.
    canDispatchSubWorkers: args.dispatchDepth < runtime.getNestedWorkerMaxDepth(),
    taskId: args.taskId,
    dispatchId: args.dispatchId,
    taskSpec: args.taskSpec,
    coordinatorHandle: agentVisibleOrchestrationAddress(args.coordinatorHandle, args.db),
    // Only the address differs by mode: a structured worker's minted handle is its mailbox key, and
    // the host binds `session:<id>` to that same caller.
    workerHandle: structuredSession
      ? `${ORCA_SESSION_ADDRESS_PREFIX}${structuredSession.identity.sessionId}`
      : terminalHandle,
    dispatchCapability: args.dispatchCapability,
    devMode: args.devMode,
    cliCommand: runtime.getTerminalOrchestrationCliCommand(terminalHandle)
  })
  if (structuredSession) {
    const delivery = await sendStructuredWorkerPreamble({
      host: structuredSession.host,
      sessionId: structuredSession.identity.sessionId,
      dispatchId: args.dispatchId,
      preamble
    })
    return {
      structuredTurnStart:
        delivery === 'accepted'
          ? { verdict: 'observed' }
          : {
              verdict: 'unobserved',
              reason:
                'The dispatch preamble was accepted, but the agent had not started to take it. It ' +
                'is delivered when the agent starts; if the worker then reports, this Dispatch ' +
                'settles normally.'
            }
    }
  }
  if (parseOrcaSessionAddress(terminalHandle)) {
    const preambleTurnMessageId = queueDispatchPreambleTurn(runtime, args.db, {
      dispatchId: args.dispatchId,
      runId: args.runId,
      from: args.coordinatorHandle,
      preamble
    })
    return { preambleTurnMessageId }
  }
  const sent = await runtime.sendTerminalAgentPrompt(
    terminalHandle,
    preamble,
    dispatchPreambleSendOptions(args.requestId)
  )
  return sent.prompt ? { prompt: sent.prompt } : {}
}
