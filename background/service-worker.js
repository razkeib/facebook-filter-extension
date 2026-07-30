import { parseGraphQLPayload } from '../lib/parser.js';
import { savePost, saveMediaBlob, clearAllData } from '../lib/db.js';

let attachedTabId = null;
const pendingRequests = new Map();

// --- RELOAD PURGE LOGIC ---
// chrome.storage.session is cleared ONLY on extension reload or browser close.
// It survives standard service worker sleep/wake cycles.
chrome.storage.session.get(['isInitialized']).then(async (result) => {
  if (!result.isInitialized) {
    await clearAllData();
    console.log("[FB Filter] Extension reloaded or started. Database purged.");
    await chrome.storage.session.set({ isInitialized: true });
  }
});

const INITIAL_FILTER_CONFIG = {
  excludedKeywords: [],
  excludedGroupIds: [],
  requiredKeywords: []
};

function passesInitialFilter(post) {
  if (!post) return false;
  if (post.group?.id && INITIAL_FILTER_CONFIG.excludedGroupIds?.includes(post.group.id)) return false;
  if (INITIAL_FILTER_CONFIG.requiredKeywords && INITIAL_FILTER_CONFIG.requiredKeywords.length > 0) {
    const text = (post.text || "").toLowerCase();
    const hasKeyword = INITIAL_FILTER_CONFIG.requiredKeywords.some(kw => text.includes(kw.toLowerCase()));
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
              const parsedPosts = parseGraphQLPayload(result.body);
              for (const post of parsedPosts) {
                if (passesInitialFilter(post)) {
                  await savePost(post);
                  console.log("[FB Filter] Saved/Updated Post:", post.postId, "by", post.author.name);

                  // NEW: Broadcast to the dashboard that a post was saved/updated
                  chrome.runtime.sendMessage({ type: "NEW_POST_SAVED", payload: post }).catch(() => {
                    // Ignore error if dashboard is not open
                  });
                }
              }
            } else if (reqData.isImage) {
              const base64Data = result.base64Encoded ? result.body : btoa(result.body);
              const mimeType = reqData.mimeType || 'image/jpeg';
              await saveMediaBlob(reqData.url, base64Data, mimeType);
            }
          } catch (e) {
            // Ignore stream processing errors
          }
        }
      );
    }
  }
});

// Legacy local storage purge check (optional fallback)
chrome.runtime.onStartup.addListener(async () => {
  const settings = await chrome.storage.local.get(['autoPurgeOnClose']);
  if (settings.autoPurgeOnClose) {
    await clearAllData();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PROCESS_SSR_SCRIPTS" && Array.isArray(message.payloads)) {
    (async () => {
      for (const rawString of message.payloads) {
        const parsedPosts = parseGraphQLPayload(rawString);
        for (const post of parsedPosts) {
          if (passesInitialFilter(post)) {
            await savePost(post);

            // NEW: Broadcast to the dashboard
            chrome.runtime.sendMessage({ type: "NEW_POST_SAVED", payload: post }).catch(() => {});
          }
        }
      }
    })();
  }
});
