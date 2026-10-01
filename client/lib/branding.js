// Read legacy keys once so a branding update preserves personal workspace data.
export function migrateWorkspaceBranding() {
  const keys = ['user_name', 'user_email', 'goals_v1', 'artifacts_v1'];
  try {
    for (const key of keys) {
      const current = `poka_${key}`;
      const legacy = `open_dots_${key}`;
      if (localStorage.getItem(current) === null && localStorage.getItem(legacy) !== null)
        localStorage.setItem(current, localStorage.getItem(legacy));
    }
  } catch { /* Existing components show errors if storage is unavailable. */ }
}
