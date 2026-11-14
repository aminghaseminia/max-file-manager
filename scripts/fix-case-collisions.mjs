/**
 * Windows checkouts cannot hold two files whose names differ only by case, but the Pure icon pack
 * ships both (e.g. `Blender.svg` → `blender.svg`). Git then reports one side as modified forever:
 * restoring the symlink writes its target text into the real icon, and restoring the icon dirties
 * the symlink.
 *
 * This script restores the real SVGs and hides the symlink aliases from `git status` with
 * `--assume-unchanged`. Nothing is deleted and nothing is committed: on Linux/macOS the symlinks
 * stay exactly as the pack ships them.
 */
import { execFileSync } from 'node:child_process'

const DIR = 'src/renderer/src/assets/pure/set/apps'

const rows = execFileSync('git', ['ls-files', '-s', '--', DIR], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const tab = line.indexOf('\t')
    const [mode, sha] = line.slice(0, tab).split(' ')
    return { mode, sha, path: line.slice(tab + 1) }
  })

const groups = new Map()
for (const row of rows) {
  const key = row.path.toLowerCase()
  const list = groups.get(key) ?? []
  list.push(row)
  groups.set(key, list)
}

const links = []
const files = []
for (const list of groups.values()) {
  if (list.length < 2) continue
  for (const row of list) (row.mode === '120000' ? links : files).push(row.path)
}

if (!links.length || !files.length) {
  console.log('no case-only collisions in the icon pack')
  process.exit(0)
}

// real icons first: their content is what the app renders
execFileSync('git', ['checkout', '--', ...files], { stdio: 'inherit' })
// the aliases are symlinks on purpose; on this filesystem they share the same file
execFileSync('git', ['update-index', '--assume-unchanged', ...links], { stdio: 'inherit' })
console.log(`hidden ${links.length} symlink aliases that share a real icon on a case-insensitive disk`)
