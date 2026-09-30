import { posix } from 'node:path'
import type { WslLaunchDirectory } from '../../shared/wsl-launch-directory'
import { parseWslUncPath, toWindowsWslUncPath } from '../../shared/wsl-paths'
import { getWslHomeAsync } from '../wsl'

/**
 * The distro directory a WSL spawn's staged line and launch file are written to, or undefined when
 * the distro home cannot be reached; the write site then refuses a launch that needs one.
 * Privacy there rests on the distro's own permissions on $HOME: Windows cannot set Linux modes
 * over the UNC share.
 */
export async function resolveWslLaunchDirectory(
  distro: string | null | undefined
): Promise<WslLaunchDirectory | undefined> {
  if (process.platform !== 'win32' || !distro) {
    return undefined
  }
  const home = parseWslUncPath((await getWslHomeAsync(distro)) ?? '')?.linuxPath
  if (!home) {
    return undefined
  }
  const linuxPath = posix.join(home, '.cache', 'orca')
  return { distro, windowsPath: toWindowsWslUncPath(linuxPath, distro), linuxPath }
}
