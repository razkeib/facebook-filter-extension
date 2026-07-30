import { getAllPosts, getMediaBlob, getMediaCount, clearAllData } from '../lib/db.js';

let allPosts = [];
const imageObjectUrls = new Set();

async function initDashboard() {
  console.log("[FB Dashboard] Initializing...");

  try {
    allPosts = await getAllPosts();
    renderStats();
    populateGroupDropdown();
    await renderFeed(allPosts);
  } catch (err) {
    console.error("[FB Dashboard] Error loading posts from DB:", err?.message || err);
  }

  // Setup Event Listeners
  document.getElementById('search-input')?.addEventListener('input', filterAndRender);
  document.getElementById('btn-purge')?.addEventListener('click', handlePurge);

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
  const searchTerm = (document.getElementById('search-input')?.value || '').toLowerCase();

  const checkedBoxes = document.querySelectorAll('.group-cb:checked');
  const selectedGroups = new Set(Array.from(checkedBoxes).map(cb => cb.value));

  const filtered = allPosts.filter(post => {
    const matchesSearch = (post.text || '').toLowerCase().includes(searchTerm) ||
                          (post.author?.name || '').toLowerCase().includes(searchTerm);

    const matchesGroup = post.group?.name ? selectedGroups.has(post.group.name) : false;

    return matchesSearch && matchesGroup;
  });

  renderFeed(filtered);
}

async function renderFeed(posts) {
  const container = document.getElementById('feed-container');
  if (!container) return;

  container.innerHTML = '';
  imageObjectUrls.forEach(url => URL.revokeObjectURL(url));
  imageObjectUrls.clear();

  if (!posts || posts.length === 0) {
    container.innerHTML = `<div class="empty-state">No posts captured yet. Scroll Facebook to start collecting!</div>`;
    return;
  }

  for (const post of posts) {
    const card = document.createElement('article');
    card.className = 'post-card';

    const avatarHtml = post.author?.profilePic
      ? `<img src="${post.author.profilePic}" class="author-avatar" alt="Avatar" referrerpolicy="no-referrer" />`
      : `<div class="author-avatar placeholder"></div>`;

    const authorLink = post.author?.url
      ? `<a href="${post.author.url}" target="_blank" class="post-author">${escapeHtml(post.author.name || "Unknown Author")}</a>`
      : `<span class="post-author">${escapeHtml(post.author?.name || "Unknown Author")}</span>`;

    const groupLink = post.group?.url
      ? `<a href="${post.group.url}" target="_blank" class="post-group">${escapeHtml(post.group.name)}</a>`
      : escapeHtml(post.group?.name || "");

    const groupText = post.group?.name && post.group.name !== "Facebook Feed"
      ? ` <span style="color: var(--text-secondary); font-weight: normal;">in</span> ${groupLink}`
      : '';

    const timeHtml = post.permalinkUrl
      ? `<a href="${post.permalinkUrl}" target="_blank" class="post-meta-link">${post.formattedDate || 'View Post'}</a>`
      : `<span class="post-meta">${post.formattedDate || ''}</span>`;

    let imagesContainerHtml = '';
    if (post.images && post.images.length > 0) {
      imagesContainerHtml = `<div class="post-images"></div>`;
    }

    card.innerHTML = `
      <div class="post-header">
        <div class="post-header-left">
          ${avatarHtml}
          <div class="post-header-info">
            <div class="post-author-line">${authorLink}${groupText}</div>
            <div class="post-meta">${timeHtml}</div>
          </div>
        </div>
      </div>
      <div class="post-content">${escapeHtml(post.text || '')}</div>
      ${imagesContainerHtml}
    `;

    container.appendChild(card);

    // Render media blobs using class target inside current card (avoids ID selector errors)
    if (post.images && post.images.length > 0) {
      const imgWrapper = card.querySelector('.post-images');
      if (imgWrapper) {
        for (const imgUrl of post.images) {
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
              imgWrapper.appendChild(imgEl);
            }
          } catch (e) {
            console.warn(`[FB Dashboard] Failed to load image blob for post ${post.postId}`, e);
          }
        }
      }
    }
  }
}

async function handlePurge() {
  if (confirm("Are you sure you want to clear all stored posts and media blobs?")) {
    await clearAllData();
    allPosts = [];
    renderStats();
    populateGroupDropdown();
    await renderFeed([]);
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
