import { getAllPosts, getMediaBlob, getMediaCount, clearAllData } from '../lib/db.js';


let allPosts = [];
const imageObjectUrls = new Set();

async function initDashboard() {
  console.log("[FB Dashboard] Initializing...");

  try {
    allPosts = await getAllPosts();
    console.log("[FB Dashboard] Fetched posts from IndexedDB:", allPosts);

    renderStats();
    populateGroupDropdown();
    await renderFeed(allPosts);
  } catch (err) {
    console.error("[FB Dashboard] Error loading posts from DB:", err);
  }

  document.getElementById('search-input')?.addEventListener('input', filterAndRender);
  document.getElementById('group-filter')?.addEventListener('change', filterAndRender);
  document.getElementById('btn-purge')?.addEventListener('click', handlePurge);
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
  const groupSelect = document.getElementById('group-filter');
  if (!groupSelect) return;

  const groups = new Set();
  allPosts.forEach(post => {
    if (post.group?.name) groups.add(post.group.name);
  });

  groupSelect.innerHTML = '<option value="ALL">All Sources</option>';
  groups.forEach(groupName => {
    const option = document.createElement('option');
    option.value = groupName;
    option.textContent = groupName;
    groupSelect.appendChild(option);
  });
}

async function renderFeed(posts) {
  const container = document.getElementById('feed-container');
  if (!container) return;

  container.innerHTML = '';

  // Free allocated Object URLs
  imageObjectUrls.forEach(url => URL.revokeObjectURL(url));
  imageObjectUrls.clear();

  if (!posts || posts.length === 0) {
    container.innerHTML = `<div class="empty-state">No posts captured yet. Scroll Facebook to start collecting!</div>`;
    return;
  }

  for (const post of posts) {
    const card = document.createElement('article');
    card.className = 'post-card';

    const authorHtml = post.author?.url
      ? `<a href="${post.author.url}" target="_blank" class="post-author">${escapeHtml(post.author.name || "Unknown Author")}</a>`
      : `<span class="post-author">${escapeHtml(post.author?.name || "Unknown Author")}</span>`;

    const groupText = post.group?.name ? ` in ${escapeHtml(post.group.name)}` : '';

    let imagesContainerHtml = '';
    if (post.images && post.images.length > 0) {
      imagesContainerHtml = `<div class="post-images" id="images-${post.postId}"></div>`;
    }

    card.innerHTML = `
      <div class="post-header">
        <div>${authorHtml}${groupText}</div>
        <div class="post-meta">${post.formattedDate || ''}</div>
      </div>
      <div class="post-content">${escapeHtml(post.text || '')}</div>
      ${imagesContainerHtml}
    `;

    container.appendChild(card);

    // Load cached images from IndexedDB
    if (post.images && post.images.length > 0) {
      const imgWrapper = card.querySelector(`#images-${post.postId}`);
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

function filterAndRender() {
  const searchTerm = (document.getElementById('search-input')?.value || '').toLowerCase();
  const selectedGroup = document.getElementById('group-filter')?.value || 'ALL';

  const filtered = allPosts.filter(post => {
    const matchesSearch = (post.text || '').toLowerCase().includes(searchTerm) ||
                          (post.author?.name || '').toLowerCase().includes(searchTerm);
    const matchesGroup = selectedGroup === 'ALL' || post.group?.name === selectedGroup;

    return matchesSearch && matchesGroup;
  });

  renderFeed(filtered);
}

async function handlePurge() {
  if (confirm("Are you sure you want to clear all stored posts and media blobs?")) {
    await clearAllData();
    allPosts = [];
    renderStats();
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
