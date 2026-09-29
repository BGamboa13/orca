/** Which delivery ran for a spawn's typed startup line, decided by the host that owns the PTY. */
export type StartupLineDelivery = 'typed' | 'staged' | 'typed-after-stage-failed'

const STARTUP_LINE_DELIVERIES: readonly StartupLineDelivery[] = [
  'typed',
  'staged',
  'typed-after-stage-failed'
]

/** What the execution host did with a spawn's startup command; absent from hosts that predate it. */
export type StartupDeliveryReport = {
  line: StartupLineDelivery
}

export function parseStartupDeliveryReport(value: unknown): StartupDeliveryReport | undefined {
  if (typeof value !== 'object' || value === null || !('line' in value)) {
    return undefined
  }
  const line = STARTUP_LINE_DELIVERIES.find((delivery) => delivery === value.line)
  return line ? { line } : undefined
}
