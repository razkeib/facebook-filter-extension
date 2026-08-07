import { parseGraphQLPayload } from '../lib/parser.js';
import { savePost, saveMediaBlob, getMediaBlob, clearAllData } from '../lib/db.js';

let attachedTabId = null;
const pendingRequests = new Map();

// --- RELOAD PURGE LOGIC ---
chrome.storage.session.get(['isInitialized']).then(async (result) => {
  if (!result.isInitialized) {
    await clearAllData();
    console.log("[FB Filter] Extension reloaded or started. Database purged.");
    await chrome.storage.session.set({ isInitialized: true });
  }
});

// --- DYNAMIC STATE CONFIG ---
let isSniffingEnabled = true;
let sniffGroupsOnly = false;
let dynamicFilterConfig = { excludedKeywords: [] };
const tabUrls = new Map(); // Tracks current tab URLs for sniffing validation

// 1. Load initial state on startup
chrome.storage.local.get(['isSniffingEnabled', 'sniffGroupsOnly', 'excludedKeywords']).then((res) => {
  if (res.isSniffingEnabled !== undefined) isSniffingEnabled = res.isSniffingEnabled;
  if (res.sniffGroupsOnly !== undefined) sniffGroupsOnly = res.sniffGroupsOnly;
  if (res.excludedKeywords) dynamicFilterConfig.excludedKeywords = res.excludedKeywords;
});

// 2. Listen for live updates from Popup
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.isSniffingEnabled !== undefined) {
      isSniffingEnabled = changes.isSniffingEnabled.newValue;
      if (!isSniffingEnabled && attachedTabId) {
        chrome.debugger.detach({ tabId: attachedTabId });
        attachedTabId = null;
        pendingRequests.clear();
        console.log("[FB Filter] Extension disabled. Debugger detached and pending requests cleared.");
      }
    }
    if (changes.sniffGroupsOnly !== undefined) {
      sniffGroupsOnly = changes.sniffGroupsOnly.newValue;
    }
    if (changes.excludedKeywords !== undefined) {
      dynamicFilterConfig.excludedKeywords = changes.excludedKeywords.newValue;
    }
  }
});

// 3. Strict Group URL Validator
function isAllowedGroupUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('facebook.com')) return false;

    const segments = parsed.pathname.split('/').filter(Boolean);

    if (segments.length !== 2) return false;
    if (segments[0] !== 'groups') return false;

    const groupIdentifier = segments[1].toLowerCase();
    if (groupIdentifier === 'feed' || groupIdentifier === 'discover') {
      return false;
    }

    return true;
  } catch (e) {
    return false;
  }
}

// 4. Pre-Ingestion Filter
function passesInitialFilter(post, tabUrl) {
  if (!post || !isSniffingEnabled) return false;

  if (sniffGroupsOnly && !isAllowedGroupUrl(tabUrl)) {
    console.log(`[FB Filter] 🚫 Discarded Post ${post.postId} by ${post.author?.name}: Not an allowed group URL.`);
    return false;
  }

  if (dynamicFilterConfig.excludedKeywords.length > 0 && post.text) {
    const textLower = post.text.toLowerCase();
    const matchedKeyword = dynamicFilterConfig.excludedKeywords.find(kw =>
      textLower.includes(kw.toLowerCase())
    );

    if (matchedKeyword) {
      console.log(`[FB Filter] 🚫 Discarded Post ${post.postId} by ${post.author?.name}: Matched excluded keyword "${matchedKeyword}".`);
      return false;
    }
  }

  return true;
}

function attachDebugger(tabId) {
  if (!isSniffingEnabled || attachedTabId === tabId) return;
  chrome.debugger.attach({ tabId }, "1.3", () => {
    if (chrome.runtime.lastError) return;
    attachedTabId = tabId;
    chrome.debugger.sendCommand({ tabId }, "Network.enable");
  });
}

// Track URL updates on Facebook tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url) {
    tabUrls.set(tabId, tab.url);
  }

  if (isSniffingEnabled && changeInfo.status === 'complete' && tab.url && tab.url.includes('facebook.com')) {
    attachDebugger(tabId);
  }
});

// Clean up tab URL cache when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabUrls.delete(tabId);
  if (tabId === attachedTabId) {
    attachedTabId = null;
  }
});

chrome.debugger.onEvent.addListener((debuggee, method, params) => {
  // Completely ignore all events if sniffing/extension is disabled
  if (!isSniffingEnabled) return;

  if (method === "Network.responseReceived") {
    const { requestId, response } = params;
    const url = response.url;

    const isGraphQL = url.includes('graphql');
    const isImage = url.includes('scontent') && url.includes('.fbcdn.net');

    if (isGraphQL || isImage) {
      pendingRequests.set(requestId, { url, mimeType: response.mimeType, isGraphQL, isImage });
    }
  }

  if (method === "Network.loadingFinished") {
    const { requestId } = params;

    if (pendingRequests.has(requestId)) {
      const reqData = pendingRequests.get(requestId);
      pendingRequests.delete(requestId);

      chrome.debugger.sendCommand(
        { tabId: debuggee.tabId },
        "Network.getResponseBody",
        { requestId },
        async (result) => {
          if (chrome.runtime.lastError || !result || !result.body) return;

          try {
            if (reqData.isGraphQL) {
              const currentTabUrl = tabUrls.get(debuggee.tabId);
              const parsedPosts = parseGraphQLPayload(result.body);
              for (const post of parsedPosts) {
                if (passesInitialFilter(post, currentTabUrl)) {
                  const saveResult = await savePost(post);

                  if (saveResult && saveResult.status === 'inserted') {
                    console.log("[FB Filter] 🟢 NEW Post Captured:", post.postId, "by", post.author?.name);
                  } else if (saveResult && saveResult.status === 'updated') {
                    console.log("[FB Filter] 🟡 UPDATED Existing Post:", post.postId, "by", post.author?.name);
                  }

                  chrome.runtime.sendMessage({ type: "NEW_POST_SAVED", payload: post }).catch(() => {});
                }
              }
            } else if (reqData.isImage) {
              const currentTabUrl = tabUrls.get(debuggee.tabId);

              if (sniffGroupsOnly && !isAllowedGroupUrl(currentTabUrl)) {
                console.debug(`[FB Filter] 🚫 Skipped Image (Not an allowed group URL):`, reqData.url);
                return;
              }

              const existingMedia = await getMediaBlob(reqData.url);
              if (existingMedia) {
                console.debug(`[FB Filter] ⏭️ Skipped Image (Already cached in DB):`, reqData.url);
                return;
              }

              const base64Data = result.base64Encoded ? result.body : btoa(result.body);
              const mimeType = reqData.mimeType || 'image/jpeg';
              await saveMediaBlob(reqData.url, base64Data, mimeType);
              console.log(`[FB Filter] 🖼️ Cached New Image`);
            }
          } catch (e) {
            // Ignore stream processing errors
          }
        }
      );
    }
  }
});

// Legacy local storage purge check
chrome.runtime.onStartup.addListener(async () => {
  const settings = await chrome.storage.local.get(['autoPurgeOnClose']);
  if (settings.autoPurgeOnClose) {
    await clearAllData();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Do not process messages if disabled
  if (!isSniffingEnabled) return;

  if (message.type === "PROCESS_SSR_SCRIPTS" && Array.isArray(message.payloads)) {
    const senderUrl = sender.tab ? sender.tab.url : null;
    (async () => {
      for (const rawString of message.payloads) {
        const parsedPosts = parseGraphQLPayload(rawString);
        for (const post of parsedPosts) {
          if (passesInitialFilter(post, senderUrl)) {
            const saveResult = await savePost(post);

            if (saveResult && saveResult.status === 'inserted') {
              console.log("[FB Filter] 🟢 NEW Post Captured (SSR):", post.postId, "by", post.author?.name);
            } else if (saveResult && saveResult.status === 'updated') {
              console.log("[FB Filter] 🟡 UPDATED Existing Post (SSR):", post.postId, "by", post.author?.name);
            }

            chrome.runtime.sendMessage({ type: "NEW_POST_SAVED", payload: post }).catch(() => {});
          }
        }
      }
    })();
  }
});
