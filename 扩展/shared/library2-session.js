(function attachLibrary2Session(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Library2Session = api;
})(globalThis, function buildLibrary2Session() {
  "use strict";

  const LOCAL_ORIGIN = "http://127.0.0.1:3000";
  const PRODUCTION_ORIGIN = "https://xhstw.qycm.top";
  const ALLOWED_ORIGINS = Object.freeze([LOCAL_ORIGIN, PRODUCTION_ORIGIN]);

  function normalizeOrigin(value) {
    try {
      const origin = new URL(value).origin;
      return ALLOWED_ORIGINS.includes(origin) ? origin : "";
    } catch (_) {
      return "";
    }
  }

  function normalizeSession(value, updatedAt) {
    if (!value || typeof value !== "object") return null;
    const appOrigin = normalizeOrigin(value.appOrigin);
    if (!appOrigin || typeof value.token !== "string" || !value.token) return null;
    if (!Number.isInteger(value.expiresAt)) return null;
    const safeUpdatedAt = Number.isInteger(updatedAt) ? updatedAt : value.updatedAt;
    if (!Number.isInteger(safeUpdatedAt)) return null;
    return {
      appOrigin,
      token: value.token,
      expiresAt: value.expiresAt,
      updatedAt: safeUpdatedAt
    };
  }

  function upsertSession(current, session, updatedAt) {
    const next = {};
    for (const origin of ALLOWED_ORIGINS) {
      const normalized = normalizeSession(current && current[origin]);
      if (normalized) next[origin] = normalized;
    }
    const normalized = normalizeSession(session, updatedAt);
    if (normalized) next[normalized.appOrigin] = normalized;
    return next;
  }

  function selectSession(current, openOrigins, now) {
    const open = new Set((Array.isArray(openOrigins) ? openOrigins : []).map(normalizeOrigin).filter(Boolean));
    const valid = ALLOWED_ORIGINS.map((origin) => normalizeSession(current && current[origin]))
      .filter((session) => session && session.expiresAt > now);
    const production = valid.find((session) => session.appOrigin === PRODUCTION_ORIGIN);
    if (production && open.has(PRODUCTION_ORIGIN)) return production;
    const local = valid.find((session) => session.appOrigin === LOCAL_ORIGIN);
    if (local && open.has(LOCAL_ORIGIN)) return local;
    return valid.sort((left, right) => right.updatedAt - left.updatedAt)[0] || null;
  }

  return Object.freeze({
    LOCAL_ORIGIN,
    PRODUCTION_ORIGIN,
    ALLOWED_ORIGINS,
    normalizeOrigin,
    upsertSession,
    selectSession
  });
});
