import { parseGraphQLPayload } from '../lib/parser.js';
import { savePost, saveMediaBlob, getMediaBlob, clearAllData } from '../lib/db.js';

let attachedTabId = null;
const pendingRequests = new Map();

// --- RELOAD PURGE LOGIC ---
const ENABLE_RELOAD_PURGE = false; // Set to true to purge data on reload, or false to preserve it

chrome.storage.session.get(['isInitialized']).then(async (result) => {
  if (!result.isInitialized) {
    if (ENABLE_RELOAD_PURGE) {
      await clearAllData();

      // Reset diagnostic data in memory and chrome.storage.local
      keywordDiscardCounts = {};
      totalDiscardedCount = 0;
      discardedPostIds = [];

      await chrome.storage.local.set({
        keywordDiscardCounts: {},
        totalDiscardedCount: 0,
        discardedPostIds: []
      });

      console.log("[FB Filter] Extension reloaded or started. Database and diagnostic stats purged.");
    }

    await chrome.storage.session.set({ isInitialized: true });
  }
});

// --- DYNAMIC STATE CONFIG ---
let isSniffingEnabled = true;
let sniffGroupsOnly = false;
let dynamicFilterConfig = { excludedKeywords: [] };
let keywordDiscardCounts = {};
let totalDiscardedCount = 0;
let discardedPostIds = []; // Track IDs of posts already discarded by keyword
const tabUrls = new Map();

// 1. Load initial state on startup
chrome.storage.local.get([
  'isSniffingEnabled', 'sniffGroupsOnly', 'excludedKeywords',
  'keywordDiscardCounts', 'totalDiscardedCount', 'discardedPostIds'
]).then((res) => {
  if (res.isSniffingEnabled !== undefined) isSniffingEnabled = res.isSniffingEnabled;
  if (res.sniffGroupsOnly !== undefined) sniffGroupsOnly = res.sniffGroupsOnly;
  if (res.excludedKeywords) dynamicFilterConfig.excludedKeywords = res.excludedKeywords;
  if (res.keywordDiscardCounts) keywordDiscardCounts = res.keywordDiscardCounts;
  if (res.totalDiscardedCount !== undefined) totalDiscardedCount = res.totalDiscardedCount;
  if (res.discardedPostIds) discardedPostIds = res.discardedPostIds;
});

// 2. Listen for live updates
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
    if (changes.sniffGroupsOnly !== undefined) sniffGroupsOnly = changes.sniffGroupsOnly.newValue;
    if (changes.excludedKeywords !== undefined) dynamicFilterConfig.excludedKeywords = changes.excludedKeywords.newValue;
    if (changes.keywordDiscardCounts !== undefined) keywordDiscardCounts = changes.keywordDiscardCounts.newValue;
    if (changes.totalDiscardedCount !== undefined) totalDiscardedCount = changes.totalDiscardedCount.newValue;
    if (changes.discardedPostIds !== undefined) discardedPostIds = changes.discardedPostIds.newValue || [];
  }
});

// 3. Strict Group URL Validator
function isAllowedGroupUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('facebook.com')) return false;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 2 || segments[0] !== 'groups') return false;
    const groupIdentifier = segments[1].toLowerCase();
    if (groupIdentifier === 'feed' || groupIdentifier === 'discover') return false;
    return true;
  } catch (e) { return false; }
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

      // Only update counters if this post ID hasn't been discarded yet
      if (!discardedPostIds.includes(post.postId)) {
        keywordDiscardCounts[matchedKeyword] = (keywordDiscardCounts[matchedKeyword] || 0) + 1;
        totalDiscardedCount++;
        discardedPostIds.push(post.postId);

        chrome.storage.local.set({ keywordDiscardCounts, totalDiscardedCount, discardedPostIds });
      }

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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url) tabUrls.set(tabId, tab.url);
  if (isSniffingEnabled && changeInfo.status === 'complete' && tab.url && tab.url.includes('facebook.com')) {
    attachDebugger(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabUrls.delete(tabId);
  if (tabId === attachedTabId) attachedTabId = null;
});

chrome.debugger.onEvent.addListener((debuggee, method, params) => {
  if (!isSniffingEnabled) return;

  if (method === "Network.responseReceived") {
    const { requestId, response } = params;
    const url = response.url;
    if (url.includes('graphql') || (url.includes('scontent') && url.includes('.fbcdn.net'))) {
      pendingRequests.set(requestId, { url, mimeType: response.mimeType, isGraphQL: url.includes('graphql'), isImage: url.includes('scontent') });
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
              if (sniffGroupsOnly && !isAllowedGroupUrl(currentTabUrl)) return;
              const existingMedia = await getMediaBlob(reqData.url);
              if (existingMedia) return;
              const base64Data = result.base64Encoded ? result.body : btoa(result.body);
              await saveMediaBlob(reqData.url, base64Data, reqData.mimeType || 'image/jpeg');
              console.log(`[FB Filter] 🖼️ Cached New Image`);
            }
          } catch (e) {}
        }
      );
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await chrome.storage.local.get(['autoPurgeOnClose']);
  if (settings.autoPurgeOnClose) await clearAllData();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
