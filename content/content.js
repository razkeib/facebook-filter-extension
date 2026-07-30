/**
 * Passive SSR Script Reader
 * Scrapes server-side rendered initial Relay state embedded in static HTML.
 */
function extractInitialSSRData() {
  const scripts = document.querySelectorAll('script[type="application/json"]');
  let rawScriptContents = [];

  scripts.forEach((script) => {
    const content = script.textContent;
    if (content && (content.includes("comet_sections") || content.includes("creation_time"))) {
      rawScriptContents.push(content);
    }
  });

  if (rawScriptContents.length > 0) {
    // Pass raw static strings to background service worker for safe parsing
    chrome.runtime.sendMessage({
      type: "PROCESS_SSR_SCRIPTS",
      payloads: rawScriptContents
    }).catch(() => {
      // Service worker might be sleeping/restarting
    });
  }
}

// Run once when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", extractInitialSSRData);
} else {
  extractInitialSSRData();
}
