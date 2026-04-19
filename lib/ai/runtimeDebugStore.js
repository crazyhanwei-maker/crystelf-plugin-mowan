const sessionDebugStore = new Map();

export function setSessionDebugSnapshot(sessionId, payload = {}) {
  if (!sessionId) return;
  sessionDebugStore.set(String(sessionId), {
    updatedAt: Date.now(),
    ...payload,
  });
}

export function getSessionDebugSnapshot(sessionId) {
  if (!sessionId) return null;
  return sessionDebugStore.get(String(sessionId)) || null;
}

export function clearSessionDebugSnapshot(sessionId) {
  if (!sessionId) return;
  sessionDebugStore.delete(String(sessionId));
}
