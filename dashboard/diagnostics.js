import { getAllPosts } from '../lib/db.js';

let capturedPostsCount = 0;

async function initDiagnostics() {
  document.getElementById('btn-back').addEventListener('click', () => {
    window.location.href = 'dashboard.html';
  });

  document.getElementById('btn-reset-stats').addEventListener('click', async () => {
    if (confirm("Reset diagnostic statistics? This will NOT delete your captured posts.")) {
      await chrome.storage.local.set({
        keywordDiscardCounts: {},
        totalDiscardedCount: 0
      });
      loadAndRenderData();
    }
  });

  // Listen for live data updates
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.keywordDiscardCounts || changes.totalDiscardedCount)) {
      loadAndRenderData();
    }
  });

  // Fetch initial posts count to calculate efficiency
  const posts = await getAllPosts();
  capturedPostsCount = posts.length;

  await loadAndRenderData();
}

async function loadAndRenderData() {
  const data = await chrome.storage.local.get(['keywordDiscardCounts', 'totalDiscardedCount']);
  const keywordCounts = data.keywordDiscardCounts || {};
  const totalDiscarded = data.totalDiscardedCount || 0;

  const totalProcessed = capturedPostsCount + totalDiscarded;
  const efficiency = totalProcessed > 0 ? ((totalDiscarded / totalProcessed) * 100).toFixed(1) : 0;

  // Render Top Stats
  document.getElementById('stat-captured').textContent = capturedPostsCount;
  document.getElementById('stat-discarded').textContent = totalDiscarded;
  document.getElementById('stat-efficiency').textContent = `${efficiency}%`;

  // Sort Keywords
  const sortedKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1]); // Sort descending by count

  const topTermEl = document.getElementById('stat-top-term');
  if (sortedKeywords.length > 0) {
    topTermEl.textContent = sortedKeywords[0][0]; // the keyword string
  } else {
    topTermEl.textContent = "None";
  }

  renderChart(sortedKeywords);
}

function renderChart(sortedKeywords) {
  const chartArea = document.getElementById('chart-area');
  chartArea.innerHTML = '';

  if (sortedKeywords.length === 0) {
    chartArea.innerHTML = '<div class="empty-chart">No keywords triggered yet.</div>';
    return;
  }

  // Find max value for percentage width calculation
  const maxCount = sortedKeywords[0][1];

  sortedKeywords.forEach(([keyword, count]) => {
    const row = document.createElement('div');
    row.className = 'bar-row';

    const widthPercent = (count / maxCount) * 100;

    row.innerHTML = `
      <div class="bar-label" title="${escapeHtml(keyword)}">${escapeHtml(keyword)}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width: 0%;" data-target-width="${widthPercent}%"></div>
      </div>
      <div class="bar-value">${count}</div>
    `;
    chartArea.appendChild(row);
  });

  // Trigger animation after brief delay for DOM to register
  requestAnimationFrame(() => {
    setTimeout(() => {
      document.querySelectorAll('.bar-fill').forEach(bar => {
        bar.style.width = bar.getAttribute('data-target-width');
      });
    }, 50);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, match => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[match]));
}

document.addEventListener('DOMContentLoaded', initDiagnostics);
