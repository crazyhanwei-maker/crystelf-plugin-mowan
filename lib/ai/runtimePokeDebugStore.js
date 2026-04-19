const pokeDebugStore = new Map();

export function setPokeDebugSnapshot(groupId, payload = {}) {
  if (!groupId) return;
  pokeDebugStore.set(String(groupId), {
    updatedAt: Date.now(),
    ...payload,
  });
}

export function getPokeDebugSnapshot(groupId) {
  if (!groupId) return null;
  return pokeDebugStore.get(String(groupId)) || null;
}

export function clearPokeDebugSnapshot(groupId) {
  if (!groupId) return;
  pokeDebugStore.delete(String(groupId));
}
