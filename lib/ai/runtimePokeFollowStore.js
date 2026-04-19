const pokeFollowStore = new Map();

export function setPokeFollowWindow(groupId, payload = null) {
  if (!groupId) return;
  if (!payload) {
    pokeFollowStore.delete(String(groupId));
    return;
  }
  pokeFollowStore.set(String(groupId), payload);
}

export function getPokeFollowWindow(groupId) {
  if (!groupId) return null;
  return pokeFollowStore.get(String(groupId)) || null;
}
