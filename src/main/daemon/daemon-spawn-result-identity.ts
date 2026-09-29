import { parseStartupDeliveryReport } from '../../shared/startup-delivery-report'
import type { PtySpawnResult } from '../providers/types'
import type { CreateOrAttachResult } from './types'

/** The daemon's identity and launch facts every spawn result carries forward from its reply. */
export function daemonSpawnResultIdentity(
  result: CreateOrAttachResult
): Pick<
  PtySpawnResult,
  'incarnationId' | 'agentSessionEnsure' | 'launchAgent' | 'startupDelivery'
> {
  const startupDelivery = parseStartupDeliveryReport(result.startupDelivery)
  return {
    ...(result.incarnationId ? { incarnationId: result.incarnationId } : {}),
    ...(result.agentSessionEnsure ? { agentSessionEnsure: result.agentSessionEnsure } : {}),
    ...(result.launchAgent ? { launchAgent: result.launchAgent } : {}),
    ...(startupDelivery ? { startupDelivery } : {})
  }
}
