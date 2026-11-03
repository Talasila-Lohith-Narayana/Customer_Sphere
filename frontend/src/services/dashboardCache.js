const CACHE_KEY_PREFIX = "customer-sphere-dashboard-cache:v1:";

function getCacheKey(username, resource, params) {
  if (!username) return null;
  return `${CACHE_KEY_PREFIX}${encodeURIComponent(username)}:${resource}:${JSON.stringify(params)}`;
}

export function readDashboardCache(username, resource, params) {
  const key = getCacheKey(username, resource, params);
  if (!key || typeof window === "undefined") return null;

  try {
    const cached = window.sessionStorage.getItem(key);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.warn("Could not read cached dashboard data.", error);
    return null;
  }
}

export function writeDashboardCache(username, resource, params, data) {
  const key = getCacheKey(username, resource, params);
  if (!key || typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.warn("Could not cache dashboard data.", error);
  }
}

export function clearDashboardCache() {
  if (typeof window === "undefined") return;

  try {
    const keys = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(CACHE_KEY_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch (error) {
    console.warn("Could not clear cached dashboard data.", error);
  }
}
