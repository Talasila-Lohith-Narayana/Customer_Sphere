export const SESSION_REVOKED_EVENT = "auth-session-revoked";
export const SESSION_REVOKED_STORAGE_KEY = "ci_session_revoked";

export function announceSessionRevocation(username) {
  const detail = {
    username,
    nonce: `${Date.now()}-${Math.random()}`,
  };
  localStorage.setItem(SESSION_REVOKED_STORAGE_KEY, JSON.stringify(detail));
  window.dispatchEvent(
    new CustomEvent(SESSION_REVOKED_EVENT, { detail }),
  );
}
