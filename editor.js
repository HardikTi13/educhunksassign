/**
 * Editor Frame Script - Bidirectional Rich Text Sync
 * Handles editing, selections, formatting commands, history stack, and postMessage communication.
 */

// Parse Frame Identifier
const urlParams = new URLSearchParams(window.location.search);
const frameId = urlParams.get('id') || 'UnknownFrame';

// DOM Elements
const editor = document.getElementById('editor');
const btnBold = document.getElementById('btn-bold');
const btnItalic = document.getElementById('btn-italic');
const btnStrikethrough = document.getElementById('btn-strikethrough');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const syncStatus = document.getElementById('sync-status');
const statusText = syncStatus.querySelector('.status-text');

// Configuration
const TYPING_DEBOUNCE_MS = 150;
const HISTORY_LIMIT = 50;

// Synchronization Locks and History State
let isRemoteUpdate = false;
let typingDebounceTimeout = null;
const historyStack = [];
let historyIndex = -1;

/**
 * Initialize Editor
 */
function init() {
  setupEventListeners();
  
  // Set initial content & push to history
  editor.innerHTML = '<div>Hello! Start editing here. Feel free to format your text.</div>';
  saveHistoryState();
  updateToolbarStates();
}

/**
 * Event Listeners Registration
 */
function setupEventListeners() {
  // Rich Text Formatting Buttons
  btnBold.addEventListener('click', () => applyFormat('bold'));
  btnItalic.addEventListener('click', () => applyFormat('italic'));
  btnStrikethrough.addEventListener('click', () => applyFormat('strikeThrough'));
  
  // Custom Undo/Redo Buttons
  btnUndo.addEventListener('click', () => triggerUndo());
  btnRedo.addEventListener('click', () => triggerRedo());

  // Input events (typing, cutting, pasting, deletes)
  editor.addEventListener('input', handleEditorInput);

  // Keyboard Shortcuts Listener for Custom Undo/Redo and Formatting
  editor.addEventListener('keydown', handleKeydown);

  // Selection Change Listener to toggle active button highlights
  document.addEventListener('selectionchange', () => {
    // Only update states if focus is inside our editor
    if (document.activeElement === editor) {
      updateToolbarStates();
    }
  });

  // postMessage Listener for Incoming Host Sync
  window.addEventListener('message', handleIncomingMessage);
}

/**
 * Apply Rich Text Formatting using execCommand
 */
function applyFormat(action) {
  editor.focus();
  document.execCommand(action, false, null);
  updateToolbarStates();
  
  // Push state to history
  saveHistoryState();

  // Send updates to the host broker
  sendSyncMessage(action);
}

/**
 * Debounced handler for text typing changes
 */
function handleEditorInput() {
  if (isRemoteUpdate) return;

  // Visual status feedback: Transition dot to Amber "Syncing..."
  setSyncingState();

  // Clear existing debounce timers
  if (typingDebounceTimeout) {
    clearTimeout(typingDebounceTimeout);
  }

  // Instantly sync typing content
  sendSyncMessage('textInput');

  // Debounce history snapshot capture to prevent layout drag
  typingDebounceTimeout = setTimeout(() => {
    saveHistoryState();
    setSyncedState();
  }, TYPING_DEBOUNCE_MS);
}

/**
 * Custom Keyboard Shortcuts Interception
 */
function handleKeydown(e) {
  const isMeta = e.ctrlKey || e.metaKey;

  if (isMeta && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    triggerUndo();
  } else if (isMeta && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    triggerRedo();
  }
}

/**
 * Get Caret/Selection Offsets relative to plain text contents
 */
function getSelectionOffsets(root) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { start: 0, end: 0 };
  }

  const range = selection.getRangeAt(0);

  // Validate range boundary starts/ends within the editor container
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return { start: 0, end: 0 };
  }

  let start = 0;
  let end = 0;
  let currentOffset = 0;

  // Traverse DOM text nodes in order
  const nodeIterator = document.createNodeIterator(
    root,
    NodeFilter.SHOW_TEXT,
    null
  );

  let currentNode;
  while ((currentNode = nodeIterator.nextNode())) {
    if (currentNode === range.startContainer) {
      start = currentOffset + range.startOffset;
    }
    if (currentNode === range.endContainer) {
      end = currentOffset + range.endOffset;
    }
    currentOffset += currentNode.textContent.length;
  }

  return { start, end };
}

/**
 * Restore Caret/Selection Offsets relative to plain text contents
 */
function restoreSelectionOffsets(root, offsets) {
  if (!offsets) return;
  const { start, end } = offsets;

  const selection = window.getSelection();
  selection.removeAllRanges();
  const range = document.createRange();

  let currentOffset = 0;
  let startNode = null;
  let startNodeOffset = 0;
  let endNode = null;
  let endNodeOffset = 0;

  const nodeIterator = document.createNodeIterator(
    root,
    NodeFilter.SHOW_TEXT,
    null
  );

  let currentNode;
  const textNodes = [];
  while ((currentNode = nodeIterator.nextNode())) {
    textNodes.push(currentNode);
  }

  if (textNodes.length === 0) {
    range.setStart(root, 0);
    range.setEnd(root, 0);
    selection.addRange(range);
    return;
  }

  // Match character positions with text content lengths
  for (const node of textNodes) {
    const length = node.textContent.length;
    if (!startNode && currentOffset + length >= start) {
      startNode = node;
      startNodeOffset = start - currentOffset;
    }
    if (!endNode && currentOffset + length >= end) {
      endNode = node;
      endNodeOffset = end - currentOffset;
    }
    currentOffset += length;
  }

  // Fallbacks if start or end offset exceeds total text lengths
  if (!startNode) {
    startNode = textNodes[textNodes.length - 1];
    startNodeOffset = startNode.textContent.length;
  }
  if (!endNode) {
    endNode = textNodes[textNodes.length - 1];
    endNodeOffset = endNode.textContent.length;
  }

  try {
    range.setStart(startNode, startNodeOffset);
    range.setEnd(endNode, endNodeOffset);
    selection.addRange(range);
  } catch (error) {
    console.warn('[Editor Sync] Could not restore caret selection offsets: ', error);
  }
}

/**
 * Push snapshot state to History Stack
 */
function saveHistoryState() {
  const currentHtml = editor.innerHTML;
  const currentSelection = getSelectionOffsets(editor);

  // Avoid creating identical duplicate history points
  if (historyStack[historyIndex] && historyStack[historyIndex].html === currentHtml) {
    return;
  }

  // Discard future states if writing after an undo operation
  historyStack.splice(historyIndex + 1);

  // Append new state
  historyStack.push({
    html: currentHtml,
    selection: currentSelection
  });

  // Keep history size within limits
  if (historyStack.length > HISTORY_LIMIT) {
    historyStack.shift();
  } else {
    historyIndex++;
  }

  updateHistoryButtons();
}

/**
 * Execute Custom History Undo
 */
function triggerUndo() {
  if (historyIndex > 0) {
    historyIndex--;
    const previousState = historyStack[historyIndex];
    
    // Apply state locally
    isRemoteUpdate = true;
    editor.innerHTML = previousState.html;
    editor.focus();
    restoreSelectionOffsets(editor, previousState.selection);
    isRemoteUpdate = false;

    updateToolbarStates();
    updateHistoryButtons();

    // Broadcast synchronization payload
    sendSyncMessage('undo');
  }
}

/**
 * Execute Custom History Redo
 */
function triggerRedo() {
  if (historyIndex < historyStack.length - 1) {
    historyIndex++;
    const nextState = historyStack[historyIndex];

    // Apply state locally
    isRemoteUpdate = true;
    editor.innerHTML = nextState.html;
    editor.focus();
    restoreSelectionOffsets(editor, nextState.selection);
    isRemoteUpdate = false;

    updateToolbarStates();
    updateHistoryButtons();

    // Broadcast synchronization payload
    sendSyncMessage('redo');
  }
}

/**
 * Update Toolbar Active Buttons Highlights
 */
function updateToolbarStates() {
  // Update Bold / Italic / Strikethrough states
  const boldActive = document.queryCommandState('bold');
  const italicActive = document.queryCommandState('italic');
  const strikethroughActive = document.queryCommandState('strikeThrough');

  btnBold.classList.toggle('active', boldActive);
  btnItalic.classList.toggle('active', italicActive);
  btnStrikethrough.classList.toggle('active', strikethroughActive);
}

/**
 * Toggle Undo/Redo button disable properties based on index
 */
function updateHistoryButtons() {
  btnUndo.disabled = (historyIndex <= 0);
  btnRedo.disabled = (historyIndex >= historyStack.length - 1);
}

/**
 * Send Sync Message through window.parent
 */
function sendSyncMessage(action) {
  const currentHtml = editor.innerHTML;
  const cursorOffset = getSelectionOffsets(editor);

  const payload = {
    type: 'FORMAT_SYNC',
    action: action,
    html: currentHtml,
    cursorOffset: cursorOffset,
    sourceId: frameId
  };

  // Restrict postMessage domain to match the page's current protocol and origin
  const targetOrigin = window.location.origin === 'null' ? '*' : window.location.origin;
  window.parent.postMessage(payload, targetOrigin);
}

/**
 * Receive message from Host Broker
 */
function handleIncomingMessage(event) {
  // Validate sender origin matches this window origin
  if (window.location.origin !== 'null' && event.origin !== window.location.origin) {
    console.warn('[Editor Sync] Rejected message from unauthorized origin:', event.origin);
    return;
  }

  const payload = event.data;
  if (!payload || payload.type !== 'FORMAT_SYNC') return;

  // Ignore reflections from ourselves (secondary guard)
  if (payload.sourceId === frameId) return;

  // Apply Remote Sync content
  applyRemoteSync(payload);
}

/**
 * Apply the synchronizing payload to editor workspace
 */
function applyRemoteSync(payload) {
  // If content matches, skip update to prevent loop cycles
  if (editor.innerHTML === payload.html) {
    return;
  }

  isRemoteUpdate = true;
  
  // Visual Feedback: Show syncing state momentarily
  setSyncingState();

  // Save selection before replacing content in case of selection overlaps
  const activeSelectionBefore = getSelectionOffsets(editor);

  // Apply HTML update
  editor.innerHTML = payload.html;

  // Restore caret selection position
  // If active user is focusing the editor, restore their cursor offset
  if (document.activeElement === editor) {
    restoreSelectionOffsets(editor, activeSelectionBefore);
  } else {
    // If not focused, set cursor position to whatever selection the remote user had
    restoreSelectionOffsets(editor, payload.cursorOffset);
  }

  // Sync internal custom history stack with the new remote payload
  syncHistoryWithRemote(payload.html, payload.cursorOffset);

  // Trigger flash visual effect
  triggerFlashAnimation();

  // Reset Lock Flag
  isRemoteUpdate = false;

  // Reset statuses & toolbars
  setTimeout(() => {
    updateToolbarStates();
    setSyncedState();
  }, 100);
}

/**
 * Inject Remote states into history stack to align undo/redo lists
 */
function syncHistoryWithRemote(html, cursorOffset) {
  // Clear future history
  historyStack.splice(historyIndex + 1);

  // Append remote state
  historyStack.push({
    html: html,
    selection: cursorOffset
  });

  if (historyStack.length > HISTORY_LIMIT) {
    historyStack.shift();
  } else {
    historyIndex++;
  }

  updateHistoryButtons();
}

/**
 * Visual feedback animations
 */
function setSyncingState() {
  syncStatus.classList.add('syncing');
  statusText.textContent = 'Syncing...';
}

function setSyncedState() {
  syncStatus.classList.remove('syncing');
  statusText.textContent = 'Synced';
}

function triggerFlashAnimation() {
  editor.classList.add('sync-flash');
  setTimeout(() => {
    editor.classList.remove('sync-flash');
  }, 600);
}

// Start Initialization
window.addEventListener('DOMContentLoaded', init);
