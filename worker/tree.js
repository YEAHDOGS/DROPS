// Broadcast tree: DropRoom (root) -> hub Fanouts -> leaf Fanouts -> viewers.
// Each node holds at most BRANCH children, so one sale costs the room BRANCH sends no matter the crowd size.
// 4096 leaves x ~5k viewers = 20M sockets at depth 2.

export const BRANCH = 64

/** Levels of Fanouts needed for this many leaves (leaves live at level = depth). */
export function depthFor(shards) {
  let depth = 1
  while (BRANCH ** depth < shards) depth++
  return depth
}

/** Durable Object name of a Fanout node. */
export const nodeName = (dropId, level, index) => `${dropId}:${level}:${index}`

/** Parse a node name, and find its parent (null = the DropRoom itself). */
export function parseNode(name) {
  const [dropId, level, index] = name.split(':')
  const lvl = Number(level)
  const idx = Number(index)
  if (!dropId || !(lvl >= 1) || !(idx >= 0)) return null
  return { dropId, level: lvl, index: idx, parent: lvl === 1 ? null : nodeName(dropId, lvl - 1, Math.floor(idx / BRANCH)) }
}
