import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** sha256 of a file, streamed so a 20 GB file does not become a 20 GB Buffer. */
export const hashFile = (p: string, algo = 'sha256'): Promise<string | null> =>
  new Promise((resolve) => {
    const h = createHash(algo)
    const rs = createReadStream(p)
    rs.on('data', (c) => h.update(c))
    rs.on('end', () => resolve(h.digest('hex')))
    rs.on('error', () => resolve(null))
  })

export async function hashMany(
  paths: string[],
  algo = 'sha256'
): Promise<{ path: string; hash: string | null }[]> {
  const out: { path: string; hash: string | null }[] = []
  for (const p of paths) out.push({ path: p, hash: await hashFile(p, algo) })
  return out
}
