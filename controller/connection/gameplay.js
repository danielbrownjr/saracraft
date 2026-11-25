// Bounded observations: registry names only, no usernames, chat, NBT or custom names.
const radius = 8
const validPosition = p => p && ['x','y','z'].every(k => Number.isFinite(p[k]))
const point = p => validPosition(p) ? { x: p.x, y: p.y, z: p.z } : null
const name = v => typeof v === 'string' && /^[a-z0-9_]{1,64}$/.test(v) ? v : null
export function inventoryCounts(bot) {
  const items = bot.inventory?.items?.()
  if (!Array.isArray(items) || items.length > 46) return null
  const counts = new Map()
  for (const item of items) {
    const key = name(item?.name)
    if (!key || !Number.isSafeInteger(item.count) || item.count < 1 || item.count > 127) return null
    counts.set(key, (counts.get(key) ?? 0) + item.count)
  }
  return counts
}
export function droppedItem(entity) {
  try {
    const item = entity?.getDroppedItem?.()
    const key = name(item?.name)
    return key && Number.isSafeInteger(item.count) && item.count > 0 && item.count <= 127
      ? { name: key, count: item.count } : null
  } catch { return null }
}
function nearby(bot) {
  const p = bot.entity?.position
  if (!validPosition(p) || !bot.entities || bot.entities[bot.entity.id] !== bot.entity) return null
  return Object.values(bot.entities).filter(e => e !== bot.entity && e?.isValid !== false &&
    Number.isSafeInteger(e?.id) && validPosition(e.position) && p.distanceTo(e.position) <= radius)
    .sort((a,b) => p.distanceTo(a.position) - p.distanceTo(b.position) || a.id - b.id)
}
export function nearestDrop(bot) {
  return nearby(bot)?.find(e => droppedItem(e)) ?? null
}
export function observeGameplay(bot, commander) {
  const counts = inventoryCounts(bot)
  const entities = nearby(bot)
  const position = point(bot.entity?.position)
  if (!counts || !entities || !position || !Number.isFinite(bot.health) || bot.health < 0 || bot.health > 2048) return null
  return { position, health: bot.health, inventory: [...counts].sort(([a],[b]) => a.localeCompare(b)).map(([name,count]) => ({name,count})),
    commander: point(commander?.position),
    nearby: entities.slice(0,16).map(e => ({ kind: name(e.name) ?? 'unknown', position: point(e.position), item: droppedItem(e) })),
    nearbyTruncated: entities.length > 16 }
}
export function statusText(state) {
  const inventory = state.inventory.slice(0,5).map(i => i.name + ':' + i.count).join(',') || 'empty'
  const p = state.position
  return ('HP ' + state.health + '; pos ' + [p.x,p.y,p.z].map(Math.floor).join(',') +
    '; inv ' + inventory + (state.inventory.length > 5 ? ',more' : '') +
    '; nearby ' + state.nearby.length + (state.nearbyTruncated ? '+' : '') +
    '; commander ' + (state.commander ? 'seen' : 'unseen')).slice(0,240)
}
export function facing(bot, target) {
  const p = bot.entity?.position, q = target?.position
  if (!validPosition(p) || !validPosition(q)) return false
  const yaw = bot.entity.yaw, pitch = bot.entity.pitch
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return false
  const dx=q.x-p.x, dy=q.y+(target.height??1.6)*0.9-p.y-(bot.entity.eyeHeight??1.62), dz=q.z-p.z
  const norm=Math.hypot(dx,dy,dz)
  if (!norm) return false
  const dot=(-Math.sin(yaw)*Math.cos(pitch)*dx+Math.sin(pitch)*dy-Math.cos(yaw)*Math.cos(pitch)*dz)/norm
  return dot >= Math.cos(0.15)
}
