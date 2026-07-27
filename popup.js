/* The manifest is the single source of truth for the version, so the popup
 * cannot drift out of sync with what is actually installed. */
document.getElementById('version').textContent =
  chrome.runtime.getManifest().version;
