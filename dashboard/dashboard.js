import { getAllPosts, getMediaBlob, getMediaCount, clearAllData, updatePostFlags } from '../lib/db.js';
import { executeSearch, getHighlightTerms } from '../lib/search-engine.js';

let priorityQueries = [];
const DEFAULT_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

let allPosts = [];
const imageObjectUrls = new Set();
let seenObserver = null;
const visibleTimers = new Map();

// Sorting State
let currentSortField = 'timestamp'; // 'timestamp' | 'tableOrder'
let isDescOrder = true;             // true = Newest First / Highest Index, false = Oldest First / Lowest Index

async function initDashboard() {
  console.log("[FB Dashboard] Initializing...");

  try {
      allPosts = await getAllPosts(); // Store raw posts directly

      await renderStats();
      await loadSavedQueries();
      populateGroupDropdown();
      setupIntersectionObserver();
      filterAndRender();
    } catch (err) {
      console.error("[FB Dashboard] Error loading posts from DB:", err?.message || err);
    }

  // Setup Event Listeners
  document.getElementById('search-input')?.addEventListener('input', filterAndRender);
  document.getElementById('cb-starred-only')?.addEventListener('change', filterAndRender);
  document.getElementById('cb-hide-seen')?.addEventListener('change', filterAndRender);
  document.getElementById('cb-show-archived')?.addEventListener('change', filterAndRender);
  document.getElementById('cb-highlight-keywords')?.addEventListener('change', filterAndRender);

  // Button Listeners
    document.getElementById('btn-diagnostics')?.addEventListener('click', () => {
      window.location.href = 'diagnostics.html';
    });

    // Modal Logic
    const purgeModal = document.getElementById('purge-modal');

    document.getElementById('btn-show-purge')?.addEventListener('click', () => {
      purgeModal.classList.add('open');
    });

    document.getElementById('btn-cancel-purge')?.addEventListener('click', () => {
      purgeModal.classList.remove('open');
      document.getElementById('cb-clear-diagnostics').checked = false; // Reset checkbox
    });

    document.getElementById('btn-confirm-purge')?.addEventListener('click', async () => {
      const alsoClearStats = document.getElementById('cb-clear-diagnostics').checked;
      await handlePurge(alsoClearStats);
      purgeModal.classList.remove('open');
      document.getElementById('cb-clear-diagnostics').checked = false;
    });

  // Sort Event Listeners
  document.getElementById('sort-select')?.addEventListener('change', (e) => {
    currentSortField = e.target.value;
    filterAndRender();
  });

  document.getElementById('btn-sort-dir')?.addEventListener('click', () => {
    isDescOrder = !isDescOrder;
    const iconEl = document.getElementById('sort-dir-icon');
    const textEl = document.getElementById('sort-dir-text');
    if (iconEl) iconEl.textContent = isDescOrder ? '⬇️' : '⬆️';
    if (textEl) textEl.textContent = isDescOrder ? 'Newest First' : 'Oldest First';
    filterAndRender();
  });

  // Dropdown toggle & Click-Outside logic
  const dropdownBtn = document.getElementById('dropdown-btn');
  const dropdownMenu = document.getElementById('dropdown-menu');

  dropdownBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu?.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!document.getElementById('group-dropdown-wrapper')?.contains(e.target)) {
      dropdownMenu?.classList.add('hidden');
    }
  });

  // Toggle All Checkbox Listener
  document.getElementById('cb-toggle-all')?.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    const itemCheckboxes = document.querySelectorAll('.group-cb');
    itemCheckboxes.forEach(cb => {
      cb.checked = isChecked;
    });
    updateDropdownLabel();
    filterAndRender();
  });

  // Listen for Live Updates from Service Worker (New Post Captures)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "NEW_POST_SAVED" && message.payload) {
      handleLivePostUpdate(message.payload);
    }
  });

  // Listen for Live Updates from Service Worker (Storage / Counter Updates)
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.discardedKeywordCount !== undefined) {
      const discardedStat = document.getElementById('stat-discarded-count');
      if (discardedStat) {
        discardedStat.textContent = changes.discardedKeywordCount.newValue || 0;
      }
    }
  });

  // Cheatsheet Controls
  const drawer = document.getElementById('cheat-sheet-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  const btnCheatSheet = document.getElementById('btn-cheat-sheet');
  const btnCloseDrawer = document.getElementById('btn-close-drawer');

  function toggleDrawer(open) {
    drawer?.classList.toggle('open', open);
    backdrop?.classList.toggle('open', open);
  }

  btnCheatSheet?.addEventListener('click', () => toggleDrawer(true));
  btnCloseDrawer?.addEventListener('click', () => toggleDrawer(false));
  backdrop?.addEventListener('click', () => toggleDrawer(false));
}

async function loadSavedQueries() {
  const data = await chrome.storage.local.get(['priorityQueries']);
  priorityQueries = data.priorityQueries || [
    { id: Date.now().toString(), text: '', color: DEFAULT_COLORS[0], active: true }
  ];

  renderQueryList();

  // Prevent duplicate event listeners if loadSavedQueries is called multiple times
  const addBtn = document.getElementById('btn-add-query');
  if (addBtn && !addBtn.dataset.listenerAttached) {
    addBtn.addEventListener('click', addQuery);
    addBtn.dataset.listenerAttached = 'true';
  }
}

function saveQueries() {
  chrome.storage.local.set({ priorityQueries });
  filterAndRender();
}

function addQuery() {
  const newColor = DEFAULT_COLORS[priorityQueries.length % DEFAULT_COLORS.length];
  priorityQueries.push({
    id: Date.now().toString(),
    text: '',
    color: newColor,
    active: true
  });
  renderQueryList();
  saveQueries();
}

function renderQueryList() {
  const list = document.getElementById('priority-queries-list');
  if (!list) return;
  list.innerHTML = '';

  priorityQueries.forEach((q, index) => {
    const li = document.createElement('li');
    li.className = `query-item ${q.active ? '' : 'inactive'}`;

    // Replaced <input type="text"> with <textarea rows="1" dir="auto">
    li.innerHTML = `
      <input type="checkbox" title="Toggle active status" class="query-toggle" ${q.active ? 'checked' : ''} data-id="${q.id}">
      <input type="color" class="query-color-picker" value="${q.color}" data-id="${q.id}">
      <textarea class="query-input" placeholder="Regex /.../ or keywords..." data-id="${q.id}" rows="1" dir="auto">${escapeHtml(q.text)}</textarea>
      <div class="query-actions">
        <button class="btn-query-action move-up" data-index="${index}" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn-query-action move-down" data-index="${index}" ${index === priorityQueries.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="btn-query-action delete-query" data-id="${q.id}">✖</button>
      </div>
    `;
    list.appendChild(li);
  });

  // Attach Textarea Auto-Resize Listeners
  const textAreas = list.querySelectorAll('.query-input');
  textAreas.forEach(el => {
    // Function to calculate and apply the correct height based on content
    const autoResize = () => {
      el.style.height = 'auto'; // Reset first to shrink if text was deleted
      el.style.height = el.scrollHeight + 'px'; // Expand to fit
    };

    // Apply exact height immediately upon rendering
    requestAnimationFrame(autoResize);

    // Update height & save to database on keystroke
    el.addEventListener('input', (e) => {
      autoResize();
      const q = priorityQueries.find(x => x.id === e.target.dataset.id);
      if (q) {
        q.text = e.target.value;
        saveQueries();
      }
    });
  });

  // Attach Other Listeners (Checkbox, Color, Arrows, Delete)
  list.querySelectorAll('.query-toggle').forEach(el => el.addEventListener('change', (e) => {
    const q = priorityQueries.find(x => x.id === e.target.dataset.id);
    if (q) { q.active = e.target.checked; renderQueryList(); saveQueries(); }
  }));

  list.querySelectorAll('.query-color-picker').forEach(el => el.addEventListener('change', (e) => {
    const q = priorityQueries.find(x => x.id === e.target.dataset.id);
    if (q) { q.color = e.target.value; saveQueries(); }
  }));

  list.querySelectorAll('.move-up').forEach(el => el.addEventListener('click', (e) => {
    const idx = parseInt(e.target.dataset.index);
    if (idx > 0) {
      [priorityQueries[idx - 1], priorityQueries[idx]] = [priorityQueries[idx], priorityQueries[idx - 1]];
      renderQueryList(); saveQueries();
    }
  }));

  list.querySelectorAll('.move-down').forEach(el => el.addEventListener('click', (e) => {
    const idx = parseInt(e.target.dataset.index);
    if (idx < priorityQueries.length - 1) {
      [priorityQueries[idx], priorityQueries[idx + 1]] = [priorityQueries[idx + 1], priorityQueries[idx]];
      renderQueryList(); saveQueries();
    }
  }));

  list.querySelectorAll('.delete-query').forEach(el => el.addEventListener('click', (e) => {
    priorityQueries = priorityQueries.filter(x => x.id !== e.target.dataset.id);
    renderQueryList(); saveQueries();
  }));
}

// Setup IntersectionObserver for 5 second visibility detection
function setupIntersectionObserver() {
  if (seenObserver) seenObserver.disconnect();

  seenObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const card = entry.target;
      const postId = card.dataset.id;
      if (!postId) return;

      if (entry.isIntersecting) {
        if (!visibleTimers.has(postId)) {
          const timer = setTimeout(async () => {
            // Retrieve all IDs assigned to this consolidated card
            const memberIds = card.dataset.memberIds ? card.dataset.memberIds.split(',') : [postId];
            let markedSeen = false;

            // Batch update all duplicates to 'Seen'
            await Promise.all(memberIds.map(async (id) => {
              const p = allPosts.find(x => x.postId === id);
              if (p && !p.isSeen) {
                p.isSeen = true;
                await updatePostFlags(id, { isSeen: true });
                markedSeen = true;
              }
            }));

            if (markedSeen && card) {
              card.classList.add('is-seen');
            }
            visibleTimers.delete(postId);
          }, 5000);

          visibleTimers.set(postId, timer);
        }
      } else {
        if (visibleTimers.has(postId)) {
          clearTimeout(visibleTimers.get(postId));
          visibleTimers.delete(postId);
        }
      }
    });
  }, { threshold: 0.5 });
}

async function renderStats() {
  const postStat = document.getElementById('stat-post-count');
  const mediaStat = document.getElementById('stat-media-count');

  if (postStat) postStat.textContent = allPosts.length;
  if (mediaStat) {
    const count = await getMediaCount();
    mediaStat.textContent = count;
  }
}

async function handlePurge(alsoClearStats) {
  await clearAllData();

  if (alsoClearStats) {
    await chrome.storage.local.set({
      keywordDiscardCounts: {},
      totalDiscardedCount: 0,
      discardedPostIds: []
    });
    console.log(`[FB Dashboard] Diagnostics reset.`);
  }

  allPosts = [];
  renderStats();
  populateGroupDropdown();
  await renderFeed([]);
  console.log(`[FB Dashboard] 🗑️ Cleared all stored posts and media`);
}

async function handleLivePostUpdate(newPost) {
  const existingIndex = allPosts.findIndex(p => p.postId === newPost.postId);

  if (existingIndex > -1) {
    allPosts[existingIndex] = { ...newPost };
  } else {
    allPosts.push(newPost);
  }

  renderStats();

  if (newPost.group?.name) {
    const existingGroups = Array.from(document.querySelectorAll('.group-cb')).map(cb => cb.value);
    if (!existingGroups.includes(newPost.group.name)) {
      populateGroupDropdown();
    }
  }

  filterAndRender();
}

function populateGroupDropdown() {
  const container = document.getElementById('dropdown-options-list');
  if (!container) return;

  const groups = new Set();
  allPosts.forEach(post => {
    if (post.group?.name) groups.add(post.group.name);
  });

  container.innerHTML = '';

  groups.forEach(groupName => {
    const label = document.createElement('label');
    label.className = 'dropdown-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = groupName;
    cb.checked = true;
    cb.className = 'group-cb';
    cb.addEventListener('change', () => {
      syncToggleAllCheckbox();
      updateDropdownLabel();
      filterAndRender();
    });

    label.appendChild(cb);
    label.appendChild(document.createTextNode(groupName));
    container.appendChild(label);
  });

  updateDropdownLabel();
}

function syncToggleAllCheckbox() {
  const allCBs = document.querySelectorAll('.group-cb');
  const checkedCBs = document.querySelectorAll('.group-cb:checked');
  const toggleAll = document.getElementById('cb-toggle-all');

  if (toggleAll) {
    toggleAll.checked = allCBs.length > 0 && allCBs.length === checkedCBs.length;
  }
}

function updateDropdownLabel() {
  const labelEl = document.getElementById('dropdown-label');
  if (!labelEl) return;

  const allCBs = document.querySelectorAll('.group-cb');
  const checkedCBs = document.querySelectorAll('.group-cb:checked');

  if (allCBs.length === 0) {
    labelEl.textContent = 'All Sources';
  } else if (checkedCBs.length === allCBs.length) {
    labelEl.textContent = 'All Sources Selected';
  } else if (checkedCBs.length === 0) {
    labelEl.textContent = 'No Sources Selected';
  } else {
    labelEl.textContent = `${checkedCBs.length} of ${allCBs.length} Selected`;
  }
}

function filterAndRender() {
  const query = document.getElementById('search-input')?.value || '';
  const starredOnly = document.getElementById('cb-starred-only')?.checked || false;
  const hideSeen = document.getElementById('cb-hide-seen')?.checked || false;
  const showArchived = document.getElementById('cb-show-archived')?.checked || false;

  const checkedBoxes = document.querySelectorAll('.group-cb:checked');
  const selectedGroups = new Set(Array.from(checkedBoxes).map(cb => cb.value));

  // 1. Pre-process: Consolidate / Group Posts by Text
  const groupedPostsMap = new Map();
  for (const post of allPosts) {
    const normText = (post.text || '').trim().toLowerCase();
    const key = normText || post.postId; // Fallback to ID if post has no text

    if (!groupedPostsMap.has(key)) {
      groupedPostsMap.set(key, {
        ...post,
        groupKey: key,
        memberPosts: [post],
        groups: post.group && post.group.name ? [post.group] : []
      });
    } else {
      const existing = groupedPostsMap.get(key);
      existing.memberPosts.push(post);

      // Append unique group sources
      if (post.group && post.group.name && !existing.groups.some(g => g.name === post.group.name)) {
        existing.groups.push(post.group);
      }
    }
  }

  // Map into an array and evaluate consolidated flags & distinct media variants
  let consolidatedPosts = Array.from(groupedPostsMap.values()).map(group => {
    group.isStarred = group.memberPosts.some(p => p.isStarred);
    group.isArchived = group.memberPosts.every(p => p.isArchived); // Only hide if ALL are archived
    group.isSeen = group.memberPosts.some(p => p.isSeen); // Considered seen if ANY are seen

    // Inject grouped string for search-engine.js compatibility
    group.group = { name: group.groups.map(g => g.name).join(', ') };

    // Assign the ID of the most recent member to the parent card
    group.postId = group.memberPosts.sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0))[0].postId;

    // Extract unique media variants across duplicate member posts
    const mediaVariants = [];
    const seenVariantKeys = new Set();

    for (const p of group.memberPosts) {
      if (p.images && p.images.length > 0) {
        const key = p.images.slice().sort().join('|'); // Key based on sorted image URLs
        if (!seenVariantKeys.has(key)) {
          seenVariantKeys.add(key);
          mediaVariants.push({
            sourceGroup: p.group?.name || 'Facebook Post',
            images: p.images
          });
        }
      }
    }
    group.mediaVariants = mediaVariants;

    return group;
  });

  // 2. Apply Base Filters to Consolidated Posts
    let filteredPosts = consolidatedPosts.filter(post => {
      return post.groups.some(g => selectedGroups.has(g.name));
    });

    filteredPosts = filteredPosts.filter(post => showArchived ? post.isArchived : !post.isArchived);
    if (starredOnly) filteredPosts = filteredPosts.filter(post => post.isStarred);
    if (hideSeen) filteredPosts = filteredPosts.filter(post => !post.isSeen || post.isStarred);

    // 3. PRIORITY WATERFALL SEARCH
    let finalFeed = [];
    let remainingPosts = [...filteredPosts];
    let matchedHighlightTerms = [];
    const highlightKeywords = document.getElementById('cb-highlight-keywords')?.checked || false;

    const activeQueries = priorityQueries.filter(q => q.active && q.text.trim());

    if (activeQueries.length === 0) {
      // If no queries are defined/active, just show everything that passed base filters
      finalFeed = remainingPosts;
    } else {
      // Cascade through active queries
      for (const pq of activeQueries) {
        if (activeQueries.length === 0) {
          // If no queries are defined/active, just show everything that passed base filters
          finalFeed = remainingPosts;
        } else {
          // Cascade through active queries (Using forEach to get the priority index)
          activeQueries.forEach((pq, index) => {
            // Find matches in the REMAINING pool
            const matches = executeSearch(pq.text, remainingPosts);

            // Process matches
            matches.forEach(post => {
              post.queryColor = pq.color; // Tag with the color of the query that caught it
              post.priorityIndex = index; // ⭐️ ADDED: Tag with priority tier
              finalFeed.push(post);
            });

            // Extract keywords for highlighting
            if (highlightKeywords) {
              matchedHighlightTerms.push(...getHighlightTerms(pq.text));
            }

            // Remove caught posts from the pool so they don't match lower-priority queries
            const matchedIds = new Set(matches.map(m => m.postId));
            remainingPosts = remainingPosts.filter(p => !matchedIds.has(p.postId));
          });
        }
      }
    }

    // 4. Sorting (Tiered)
        finalFeed.sort((a, b) => {
          // ⭐️ PRIMARY TIER: Priority Group Sorting
          // If a post wasn't caught by a query, it gets assigned Infinity (lowest priority)
          const priorityA = a.priorityIndex !== undefined ? a.priorityIndex : Infinity;
          const priorityB = b.priorityIndex !== undefined ? b.priorityIndex : Infinity;

          if (priorityA !== priorityB) {
            return priorityA - priorityB; // Lowest index (highest priority) comes first
          }

          // ⭐️ SECONDARY TIER: Time Sorting (Fallback for posts in the same group)
          let valA, valB;
          if (currentSortField === 'timestamp') {
            valA = a.timestamp ? a.timestamp * 1000 : 0;
            valB = b.timestamp ? b.timestamp * 1000 : 0;
          } else {
            valA = a.capturedAt ?? 0;
            valB = b.capturedAt ?? 0;
          }
          return isDescOrder ? valB - valA : valA - valB;
        });

    // Pass the waterfall results and aggregated highlight terms to render
    renderFeed(finalFeed, matchedHighlightTerms);
  }

  function createPostCard(post, activeTerms = []) {
    const card = document.createElement('article');

    const classes = ['post-card'];
    if (post.isSeen) classes.push('is-seen');
    if (post.isArchived) classes.push('is-archived');

    card.className = classes.join(' ');
    // Apply query color coding if it was caught by a priority query
    if (post.queryColor) {
      card.style.borderLeft = `6px solid ${post.queryColor}`;
    } else {
      card.style.borderLeft = `6px solid transparent`; // Reset
    }

    card.dataset.id = post.postId;
    card.dataset.memberIds = post.memberPosts ? post.memberPosts.map(p => p.postId).join(',') : post.postId;

    const avatarHtml = post.author?.profilePic
      ? `<img src="${post.author.profilePic}" class="author-avatar" alt="Avatar" referrerpolicy="no-referrer" />`
      : `<div class="author-avatar placeholder"></div>`;

    const authorLink = post.author?.url
      ? `<a href="${post.author.url}" target="_blank" class="post-author">${escapeHtml(post.author.name || "Unknown Author")}</a>`
      : `<span class="post-author">${escapeHtml(post.author?.name || "Unknown Author")}</span>`;

    // 1. MODIFIED: Redirect group hyperlinks to the specific post permalink if available
    const groupLinksHtml = (post.groups || [post.group]).filter(g => g && g.name && g.name !== "Facebook Feed").map(g => {
      const targetUrl = post.permalinkUrl || g.url; // Fallback to group URL if permalink is missing
      return targetUrl
        ? `<a href="${targetUrl}" target="_blank" class="post-group">${escapeHtml(g.name)}</a>`
        : escapeHtml(g.name);
    }).join(' • ');

    const groupText = groupLinksHtml.length > 0
      ? ` <span style="color: var(--text-secondary); font-weight: normal;">in</span> ${groupLinksHtml}`
      : '';

    const timeHtml = post.permalinkUrl
      ? `<a href="${post.permalinkUrl}" target="_blank" class="post-meta-link">${post.formattedDate || 'View Post'}</a>`
      : `<span class="post-meta">${post.formattedDate || ''}</span>`;

    const archivedBadgeHtml = post.isArchived
      ? `<span class="badge-archived" title="This post is archived">📦 Archived</span>`
      : '';

    // Construct Media Switcher UI if media exists
    let imagesContainerHtml = '';
    if (post.mediaVariants && post.mediaVariants.length > 0) {
      const hasMultipleVariants = post.mediaVariants.length > 1;
      const switcherHtml = hasMultipleVariants ? `
        <div class="media-switcher">
          <button class="btn-media-nav btn-media-prev" title="Previous media variant">◀</button>
          <span class="media-variant-info">Media 1 of ${post.mediaVariants.length} (${escapeHtml(post.mediaVariants[0].sourceGroup)})</span>
          <button class="btn-media-nav btn-media-next" title="Next media variant">▶</button>
        </div>
      ` : '';

      imagesContainerHtml = `
        <div class="post-media-section">
          ${switcherHtml}
          <div class="post-images"></div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="post-header">
        <div class="post-header-left">
          ${avatarHtml}
          <div class="post-header-info">
            <div class="post-author-line">${authorLink}${groupText} ${archivedBadgeHtml}</div>
            <div class="post-meta">${timeHtml}</div>
          </div>
        </div>
        <div class="post-card-actions">
          <button class="btn-icon btn-star ${post.isStarred ? 'active' : ''}" title="${post.isStarred ? 'Unstar post' : 'Star post'}">
            ${post.isStarred ? '⭐' : '☆'}
          </button>
          <button class="btn-icon btn-archive ${post.isArchived ? 'active' : ''}" title="${post.isArchived ? 'Remove from archive' : 'Archive post'}">
            ${post.isArchived ? '📥' : '📦'}
          </button>
        </div>
      </div>
      <div class="post-content" dir="auto">${highlightTextSafe(post.text || '', activeTerms)}</div>
      ${imagesContainerHtml}
    `;

    // Attach Media Navigation Event Listeners
    if (post.mediaVariants && post.mediaVariants.length > 1) {
      let activeIndex = 0;
      const prevBtn = card.querySelector('.btn-media-prev');
      const nextBtn = card.querySelector('.btn-media-next');
      const infoSpan = card.querySelector('.media-variant-info');
      const imgWrapper = card.querySelector('.post-images');

      const switchVariant = async (newIdx) => {
        activeIndex = newIdx;
        if (infoSpan) {
          infoSpan.textContent = `Media ${activeIndex + 1} of ${post.mediaVariants.length} (${post.mediaVariants[activeIndex].sourceGroup})`;
        }
        await renderImageGrid(imgWrapper, post.mediaVariants[activeIndex].images);
      };

      prevBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const newIdx = (activeIndex - 1 + post.mediaVariants.length) % post.mediaVariants.length;
        switchVariant(newIdx);
      });

      nextBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const newIdx = (activeIndex + 1) % post.mediaVariants.length;
        switchVariant(newIdx);
      });
    }

    // Batch Star Updates
    const btnStar = card.querySelector('.btn-star');
    btnStar?.addEventListener('click', async (e) => {
      e.stopPropagation();
      post.isStarred = !post.isStarred;
      btnStar.innerHTML = post.isStarred ? '⭐' : '☆';
      btnStar.title = post.isStarred ? 'Unstar post' : 'Star post';
      btnStar.classList.toggle('active', post.isStarred);

      const targets = post.memberPosts || [post];
      await Promise.all(targets.map(p => updatePostFlags(p.postId, { isStarred: post.isStarred })));
      targets.forEach(p => p.isStarred = post.isStarred);

      // 3. MODIFIED: Localized DOM update for stars
      const starredOnlyChecked = document.getElementById('cb-starred-only')?.checked;
      if (!post.isStarred && starredOnlyChecked) {
        card.style.display = 'none'; // Instantly hide if we unstar while in "Starred Only" mode
      }
    });

    // Batch Archive Updates
    const btnArchive = card.querySelector('.btn-archive');
    btnArchive?.addEventListener('click', async (e) => {
      e.stopPropagation();
      post.isArchived = !post.isArchived;
      btnArchive.title = post.isArchived ? 'Remove from archive' : 'Archive post';
      btnArchive.innerHTML = post.isArchived ? '📥' : '📦';
      btnArchive.classList.toggle('active', post.isArchived);

      const targets = post.memberPosts || [post];
      await Promise.all(targets.map(p => updatePostFlags(p.postId, { isArchived: post.isArchived })));
      targets.forEach(p => p.isArchived = post.isArchived);

      // 3. MODIFIED: Localized DOM updates instead of filterAndRender()
      const showArchivedChecked = document.getElementById('cb-show-archived')?.checked;

      if (post.isArchived && !showArchivedChecked) {
        card.style.display = 'none'; // Instantly hide the card so you don't lose scroll position
      } else {
        // Otherwise, visually update the card in place
        card.classList.toggle('is-archived', post.isArchived);

        const authorLine = card.querySelector('.post-author-line');
        if (post.isArchived) {
          if (!authorLine.querySelector('.badge-archived')) {
            authorLine.insertAdjacentHTML('beforeend', ` <span class="badge-archived" title="This post is archived">📦 Archived</span>`);
          }
        } else {
          const badge = authorLine.querySelector('.badge-archived');
          if (badge) badge.remove();
        }
      }
    });

    return card;
  }

async function renderImageGrid(container, imageUrls) {
  if (!container) return;
  container.innerHTML = '';

  if (!imageUrls || imageUrls.length === 0) return;

  for (const imgUrl of imageUrls) {
    try {
      const mediaRecord = await getMediaBlob(imgUrl);
      if (mediaRecord) {
        const byteCharacters = atob(mediaRecord.base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: mediaRecord.mimeType });
        const objectUrl = URL.createObjectURL(blob);
        imageObjectUrls.add(objectUrl);

        const imgEl = document.createElement('img');
        imgEl.src = objectUrl;
        imgEl.alt = "Post image";
        container.appendChild(imgEl);
      }
    } catch (e) {
      console.warn(`[FB Dashboard] Failed to load image blob`, e);
    }
  }
}

function highlightTextSafe(rawText, terms) {
  const textStr = rawText || '';
  if (!terms || terms.length === 0) return escapeHtml(textStr);

  const regexPatterns = [];
  terms.forEach(term => {
    if (term.type === 'regex') {
       regexPatterns.push(term.value.source);
    } else if (term.value) {
       // Escape special regex characters in plain text searches
       regexPatterns.push(term.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
  });

  if (regexPatterns.length === 0) return escapeHtml(textStr);

  // Combine all patterns into a single global, case-insensitive regex
  const combinedRegex = new RegExp(regexPatterns.join('|'), 'gi');

  let result = '';
  let lastIndex = 0;
  let match;

  // Use .exec() on raw text to find matches before escaping HTML.
  // This prevents accidentally matching/breaking entities like &amp;
  // and prevents nested <mark> tags!
  while ((match = combinedRegex.exec(textStr)) !== null) {
    // Prevent infinite loops on zero-length matches from bad user regex
    if (match.index === combinedRegex.lastIndex) {
        combinedRegex.lastIndex++;
        continue;
    }

    // 1. Escape and append the text BEFORE the match
    result += escapeHtml(textStr.substring(lastIndex, match.index));

    // 2. Escape and wrap the MATCHED text
    result += `<mark class="kw-highlight">${escapeHtml(match[0])}</mark>`;

    lastIndex = combinedRegex.lastIndex;
  }

  // 3. Escape and append remaining text AFTER the last match
  result += escapeHtml(textStr.substring(lastIndex));

  return result;
}

async function renderFeed(posts, activeTerms = []) {
  const container = document.getElementById('feed-container');
  const showingStat = document.getElementById('stat-showing-count');

  if (showingStat) showingStat.textContent = posts ? posts.length : 0;
  if (!container) return;

  if (seenObserver) seenObserver.disconnect();
  visibleTimers.forEach(timer => clearTimeout(timer));
  visibleTimers.clear();

  container.innerHTML = '';
  imageObjectUrls.forEach(url => URL.revokeObjectURL(url));
  imageObjectUrls.clear();

  if (!posts || posts.length === 0) {
    container.innerHTML = `<div class="empty-state">No posts match your filters.</div>`;
    return;
  }

  for (const post of posts) {
      const card = createPostCard(post, activeTerms);
      container.appendChild(card);

    if (seenObserver) seenObserver.observe(card);

    // Render the default (first) media variant if present
    if (post.mediaVariants && post.mediaVariants.length > 0) {
      const imgWrapper = card.querySelector('.post-images');
      await renderImageGrid(imgWrapper, post.mediaVariants[0].images);
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, match => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[match]));
}

document.addEventListener('DOMContentLoaded', initDashboard);
