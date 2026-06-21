/**
 * Host Page Script - Message Broker & Dashboard logger
 * Manages postMessage redirection between the side-by-side frames.
 */

// DOM Elements
const frameA = document.getElementById('frame-a');
const frameB = document.getElementById('frame-b');
const logTerminal = document.getElementById('log-terminal');
const btnClearLogs = document.getElementById('btn-clear-logs');
const chkAutoscroll = document.getElementById('chk-autoscroll');
const statSyncCount = document.getElementById('stat-sync-count');

// Dashboard State
let totalRelays = 0;

/**
 * Initialize Host
 */
function init() {
  setupEventListeners();
}

/**
 * Setup Window Listeners
 */
function setupEventListeners() {
  // Listen for message events relayed by the editor frames
  window.addEventListener('message', handleIncomingMessage);

  // Clear Logs trigger
  btnClearLogs.addEventListener('click', clearActionLogs);
}

/**
 * Handle incoming postMessages and route to opposing frame
 */
function handleIncomingMessage(event) {
  const hostOrigin = window.location.origin;

  // Validate Origin for security (except local null paths)
  if (hostOrigin !== 'null' && event.origin !== hostOrigin) {
    console.warn('[Host Broker] Rejected message from unauthorized origin:', event.origin);
    return;
  }

  const payload = event.data;
  if (!payload || payload.type !== 'FORMAT_SYNC') return;

  // Track sources and destinations
  let sourceName = '';
  let destName = '';
  let targetWindow = null;
  let sourceDotId = '';
  let destDotId = '';

  if (event.source === frameA.contentWindow) {
    sourceName = 'Frame A';
    destName = 'Frame B';
    targetWindow = frameB.contentWindow;
    sourceDotId = 'sync-dot-a';
    destDotId = 'sync-dot-b';
  } else if (event.source === frameB.contentWindow) {
    sourceName = 'Frame B';
    destName = 'Frame A';
    targetWindow = frameA.contentWindow;
    sourceDotId = 'sync-dot-b';
    destDotId = 'sync-dot-a';
  } else {
    // Message from unrecognized sub-frame / external script
    return;
  }

  // Relay the packet to target frame
  const targetOrigin = hostOrigin === 'null' ? '*' : hostOrigin;
  targetWindow.postMessage(payload, targetOrigin);

  // Update Stats
  totalRelays++;
  statSyncCount.textContent = totalRelays;

  // Trigger Host Dashboard visual indicators
  triggerVisualSyncEffect(sourceDotId, destDotId);

  // Write Row to Broker Live Terminal Panel
  appendActionLog(sourceName, destName, payload);
}

/**
 * Trigger visual sync-dot flow animation
 */
function triggerVisualSyncEffect(sourceId, destId) {
  const sourceDot = document.getElementById(sourceId);
  const destDot = document.getElementById(destId);

  if (sourceDot && destDot) {
    // Cool sequential animation: source lights up first, then target
    sourceDot.classList.add('active-sync');
    setTimeout(() => {
      sourceDot.classList.remove('active-sync');
      destDot.classList.add('active-sync');
      setTimeout(() => {
        destDot.classList.remove('active-sync');
      }, 200);
    }, 120);
  }
}

/**
 * Append entry inside Broker Log Terminal
 */
function appendActionLog(source, destination, payload) {
  // Clear placeholder if first entry
  const placeholder = logTerminal.querySelector('.log-placeholder');
  if (placeholder) {
    placeholder.remove();
  }

  const now = new Date();
  const timeString = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

  const logRow = document.createElement('div');
  logRow.className = 'log-row';

  // Format code classes based on format buttons
  let actionClass = 'log-action-textInput';
  if (['bold', 'italic', 'strikeThrough'].includes(payload.action)) {
    actionClass = `log-action-${payload.action}`;
  } else if (['undo', 'redo'].includes(payload.action)) {
    actionClass = 'log-action-undo';
  }

  // Source Frame Styling Badge Class
  const sourceBadgeClass = source === 'Frame A' ? 'log-badge-a' : 'log-badge-b';
  const destBadgeClass = destination === 'Frame A' ? 'log-badge-a' : 'log-badge-b';

  // Escape HTML payload preview to avoid raw tag renderings in logs
  const escapedHtml = payload.html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const contentSummary = payload.html.replace(/<[^>]*>/g, '').substring(0, 40);
  const textPreview = contentSummary ? `"${contentSummary}..."` : '(empty editor)';
  
  logRow.innerHTML = `
    <span class="log-time">${timeString}</span>
    <span class="log-badge ${sourceBadgeClass}">${source}</span>
    <span class="log-arrow">→</span>
    <span class="log-action ${actionClass}">${payload.action}</span>
    <span class="log-arrow">→</span>
    <span class="log-badge ${destBadgeClass}">${destination}</span>
    <span class="log-details">
      ${textPreview} <span class="log-details-toggle">[Inspect HTML]</span>
      <div class="log-details-content">${escapedHtml}</div>
    </span>
  `;

  // Toggle dropdown inspection panel
  const toggleBtn = logRow.querySelector('.log-details-toggle');
  const detailsContent = logRow.querySelector('.log-details-content');
  toggleBtn.addEventListener('click', () => {
    const isOpen = detailsContent.classList.contains('open');
    if (isOpen) {
      detailsContent.classList.remove('open');
      toggleBtn.textContent = '[Inspect HTML]';
    } else {
      detailsContent.classList.add('open');
      toggleBtn.textContent = '[Collapse HTML]';
    }
  });

  // Append & Autoscroll
  logTerminal.appendChild(logRow);

  if (chkAutoscroll.checked) {
    logTerminal.scrollTop = logTerminal.scrollHeight;
  }

  // Cap number of logs to 100 to prevent layout memory bloat
  const rows = logTerminal.querySelectorAll('.log-row');
  if (rows.length > 100) {
    rows[0].remove();
  }
}

/**
 * Reset Broker Console Panel
 */
function clearActionLogs() {
  logTerminal.innerHTML = `
    <div class="log-placeholder">Waiting for editor changes... Type or format text above to trigger actions.</div>
  `;
}

// Start Initialization
init();
