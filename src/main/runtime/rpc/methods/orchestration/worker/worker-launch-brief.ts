/**
 * A worker's dispatch brief delivered on its agent's launch command line, in a sensitive launch
 * file, instead of pasted into the agent's screen once it looks ready.
 *
 * Why: a paste races the agent's startup; a fresh Codex lost or truncated worker briefs, and Enter
 * could land on a startup dialog (#23745). The brief carries the worker's handle and dispatch
 * capability, so both are minted before the spawn. The capability authorizes nothing until
 * `prepareStartingWorkerAuthority` binds its hash to the live terminal.
 */
import { getAppEnvironment } from '../../../../../../shared/app-environment'
import { carryInLaunchFile, type LaunchFile } from '../../../../../../shared/launch-prompt-file'
import { agentReadsLaunchFile } from '../../../../../../shared/startup-plan-launch-file'
import type { TuiAgent } from '../../../../../../shared/tui-agent'
import { agentPromptRidesLaunchCommand } from '../../../../../../shared/tui-agent-startup'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { resolveTerminalOrchestrationCliCommand } from '../../../../orchestration/cli-command'
import { mintDispatchCapability } from '../../../../orchestration/db/worker-dispatch/worker-dispatch-authority'
import { buildDispatchPreamble } from '../../../../orchestration/preamble'

export type WorkerLaunchBrief = {
  /** Pre-allocated: the brief names the worker's handle before its terminal exists. */
  handle: string
  capability: string
  startupPrompt: string
  launchFile: LaunchFile
  /** Taken before the spawn: only a prompt-carrying hook turn after it proves the brief landed. */
  launchStartedAt: number
}

export type WorkerLaunchBriefFactory = (worktreeId: string) => Promise<WorkerLaunchBrief>

export function createWorkerLaunchBriefFactory(args: {
  runtime: OrcaRuntimeService
  agent: TuiAgent | undefined
  dispatchId: string
  dispatchDepth: number
  taskId: string
  taskSpec: string
  coordinatorHandle: string
  devMode: boolean | undefined
}): WorkerLaunchBriefFactory | undefined {
  const { runtime, agent } = args
  // Why: an agent that takes its text only after start has no launch command to carry it, and one
  // not measured reading its launch file would stop on an approval; both keep the paste.
  if (!agent || !agentPromptRidesLaunchCommand(agent) || !agentReadsLaunchFile(agent)) {
    return undefined
  }
  return async (worktreeId) => {
    const scope = await runtime.showTerminalWorkspaceLaunchScope(`id:${worktreeId}`)
    const target = {
      connectionId: scope.connectionId,
      isWsl: undefined,
      worktreeId,
      projectRuntime: runtime.resolveProjectRuntimeForWorktree(worktreeId)
    }
    const handle = runtime.createPreAllocatedTerminalHandle()
    const capability = mintDispatchCapability()
    const brief = buildDispatchPreamble({
      canDispatchSubWorkers: args.dispatchDepth < runtime.getNestedWorkerMaxDepth(),
      taskId: args.taskId,
      dispatchId: args.dispatchId,
      taskSpec: args.taskSpec,
      coordinatorHandle: args.coordinatorHandle,
      workerHandle: handle,
      dispatchCapability: capability,
      devMode: args.devMode,
      cliCommand: resolveTerminalOrchestrationCliCommand({
        ...target,
        runtimeCliCommand: getAppEnvironment().isPackaged() ? undefined : 'orca-dev'
      })
    })
    const { prompt, launchFile } = carryInLaunchFile(brief, true)
    return { handle, capability, startupPrompt: prompt, launchFile, launchStartedAt: Date.now() }
  }
}
