// Per-user data the service worker keeps for offline reads (vite.config.ts → megs-api-*). Signed-in
// reads are keyed by user, so two people on one device never see each other's data; signing out still
// removes every copy, guest catalog included, so nothing personal outlives the session.

/** Deletes every cached Supabase read. Safe to call when caches are unavailable. */
export async function clearUserCaches() {
  try {
    if (typeof caches === 'undefined') return
    const names = await caches.keys()
    await Promise.all(names.filter((n) => n.startsWith('megs-api-')).map((n) => caches.delete(n)))
  } catch {
    /* storage blocked (private mode): nothing was cached */
  }
}
