/* The manifest is the single source of truth for the version, so the popup
 * cannot drift out of sync with what is actually installed. */
document.getElementById('version').textContent =
  chrome.runtime.getManifest().version;

/* The popup only touches chrome.storage. content.js listens for that change
 * in every admin tab and every embedded app frame and applies it, exactly as
 * if the in-page button had been clicked -- so there is one code path for
 * turning the theme on and off, not two that can drift. */
const toggle = document.getElementById('toggle');

chrome.storage.local.get('enabled', (stored) => {
  toggle.checked = Boolean(stored.enabled);
});

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: toggle.checked });
});

/* Keep the switch honest if the in-page button is clicked while the popup
 * is open. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) {
    toggle.checked = Boolean(changes.enabled.newValue);
  }
});
