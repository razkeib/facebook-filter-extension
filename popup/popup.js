document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('sniff-toggle');
  const groupsOnlyToggle = document.getElementById('groups-only-toggle');
  const keywordsInput = document.getElementById('exclude-keywords');
  const btnDashboard = document.getElementById('btn-dashboard');

  // Load settings from Chrome storage
  const data = await chrome.storage.local.get(['isSniffingEnabled', 'sniffGroupsOnly', 'excludedKeywords']);

  toggle.checked = data.isSniffingEnabled !== false;
  groupsOnlyToggle.checked = data.sniffGroupsOnly === true;
  keywordsInput.value = (data.excludedKeywords || []).join(', ');

  // Storage change listeners
  toggle.addEventListener('change', () => {
    chrome.storage.local.set({ isSniffingEnabled: toggle.checked });
  });

  groupsOnlyToggle.addEventListener('change', () => {
    chrome.storage.local.set({ sniffGroupsOnly: groupsOnlyToggle.checked });
  });

  keywordsInput.addEventListener('input', () => {
    const keywords = keywordsInput.value
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    chrome.storage.local.set({ excludedKeywords: keywords });
  });

  btnDashboard.addEventListener('click', () => {
    chrome.tabs.create({ url: "dashboard/dashboard.html" });
  });
});
