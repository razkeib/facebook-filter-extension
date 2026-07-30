import { parseGraphQLPayload } from '../lib/parser.js';
import { savePost, saveMediaBlob, clearAllData } from '../lib/db.js';

let attachedTabId = null;

// Sets & Maps for safe image alignment
const allowedImageUrls = new Set();
const pendingImages = new Map(); // Key: URL, Value: { base64Data, mimeType, timestamp }

const INITIAL_FILTER_CONFIG = {
  excludedKeywords: [],
  excludedGroupIds: []
};

function passesInitialFilter(post) {
  if (!post) return false;

  // 1. Exclude specific groups if configured
  if (post.group?.id && INITIAL_FILTER_CONFIG.excludedGroupIds?.includes(post.group.id)) {
    return false;
  }

  // 2. Filter by keywords if configured
  if (INITIAL_FILTER_CONFIG.requiredKeywords?.length > 0) {
    const text = (post.text || "").toLowerCase();
    const hasKeyword = INITIAL_FILTER_CONFIG.requiredKeywords.some(kw =>
      text.includes(kw.toLowerCase())
    );
    if (!hasKeyword) return false;
  }

  return true;
}

function attachDebugger(tabId) {
  if (attachedTabId === tabId) return;

  chrome.debugger.attach({ tabId }, "1.3", () => {
    if (chrome.runtime.lastError) return;
    attachedTabId = tabId;
    chrome.debugger.sendCommand({ tabId }, "Network.enable");
  });
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "dashboard/dashboard.html" });
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === attachedTabId) attachedTabId = null;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('facebook.com')) {
    attachDebugger(tabId);
  }
});

chrome.debugger.onEvent.addListener((debuggee, method, params) => {
  if (method === "Network.responseReceived") {
    const { requestId, response } = params;
    const url = response.url;

    const isGraphQL = url.includes('/api/graphql/');
    const isImage = url.includes('scontent') && url.includes('.fbcdn.net');

    if (isGraphQL || isImage) {
      chrome.debugger.sendCommand(
        { tabId: debuggee.tabId },
        "Network.getResponseBody",
        { requestId },
        async (result) => {
          if (chrome.runtime.lastError || !result || !result.body) return;

          try {
            // A. Handle GraphQL Responses
            if (isGraphQL) {
              const parsedPosts = parseGraphQLPayload(result.body);

              for (const post of parsedPosts) {
                if (passesInitialFilter(post)) {
                  await savePost(post);
                  console.log("[FB Filter] Saved Post:", post.postId, "by", post.author.name);
                }
              }
            }

            // B. Handle CDN Images (Bypass all queue/allowed logic & save directly!)
            else if (isImage) {
              const base64Data = result.base64Encoded ? result.body : btoa(result.body);
              const mimeType = response.mimeType || 'image/jpeg';

              // Unconditionally write directly to IndexedDB
              await saveMediaBlob(url, base64Data, mimeType);
              console.debug("[FB Image Filter - Debug] Direct saved image blob:", url.substring(0, 60));
            }
          } catch (e) {
            // Ignore stream processing errors
          }
        }
      );
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await chrome.storage.local.get(['autoPurgeOnClose']);
  if (settings.autoPurgeOnClose) {
    await clearAllData();
    console.log("[FB Filter] Auto-purged session data on startup.");
  }
});

// Message listener to receive initial script payloads and pass them through parseGraphQLPayload
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PROCESS_SSR_SCRIPTS" && Array.isArray(message.payloads)) {
    (async () => {
      for (const rawString of message.payloads) {
        const parsedPosts = parseGraphQLPayload(rawString);
        for (const post of parsedPosts) {
          if (passesInitialFilter(post)) {
            await savePost(post);
            console.log("[FB Filter] Saved SSR initial post:", post.postId, "by", post.author.name);
            (post.images || []).forEach(imgUrl => allowedImageUrls.add(imgUrl));
          }
        }
      }
    })();
  }
});
