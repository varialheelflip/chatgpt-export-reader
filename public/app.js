const state = {
  list: [],
  current: null,
  selectedByParent: {},
  dataDir: null,
  openMenuId: null,
  openMenuPosition: null,
  deletingConversationId: null
};

const listEl = document.getElementById('conversation-list');
const messagesEl = document.getElementById('chat-messages');
const messageTpl = document.getElementById('message-template');
const directoryFormEl = document.getElementById('directory-form');
const directoryInputEl = document.getElementById('directory-input');
const saveDirectoryBtnEl = document.getElementById('save-directory-btn');
const clearDirectoryBtnEl = document.getElementById('clear-directory-btn');
const directoryStatusEl = document.getElementById('directory-status');
const dialogOverlayEl = document.getElementById('dialog-overlay');
const dialogTitleEl = document.getElementById('dialog-title');
const dialogMessageEl = document.getElementById('dialog-message');
const dialogCancelBtnEl = document.getElementById('dialog-cancel-btn');
const dialogConfirmBtnEl = document.getElementById('dialog-confirm-btn');

let activeDialog = null;

function escapeHtml(input) {
  if (typeof input !== 'string') return '';

  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderMarkdown(markdown) {
  if (!markdown) return '';

  let html = escapeHtml(markdown);

  html = html.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const langClass = lang ? ` class="lang-${lang}"` : '';
    return `<pre><code${langClass}>${code.trimEnd()}</code></pre>`;
  });

  html = html
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
    .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');

  html = html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

  html = html.replace(/(?:^|\n)([-*])\s+(.+)(?=\n|$)/g, (_match, _marker, item, offset, source) => {
    const prev = source.slice(0, offset);
    const openList = prev.endsWith('</li>') ? '' : '<ul>';
    return `${openList}<li>${item}</li>`;
  });

  html = html.replace(/(<li>.*?<\/li>)(?!\s*<li>)/gs, '$1</ul>');

  html = html
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (/^<(h\d|ul|pre|blockquote)/.test(trimmed)) return trimmed;
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');

  return html;
}

function setDirectoryStatus(message, type = '') {
  directoryStatusEl.textContent = message || '';
  directoryStatusEl.className = `directory-status ${type}`.trim();
}

function setDirectoryFormDisabled(disabled) {
  directoryInputEl.disabled = disabled;
  saveDirectoryBtnEl.disabled = disabled;
  clearDirectoryBtnEl.disabled = disabled;
}

function resetConversationView(message) {
  state.current = null;
  state.selectedByParent = {};
  messagesEl.innerHTML = `<div class="empty">${message}</div>`;
}

function getMenuPosition(clientX, clientY) {
  const margin = 8;
  const estimatedWidth = 96;
  const estimatedHeight = 48;

  return {
    left: Math.max(margin, Math.min(clientX + 8, window.innerWidth - estimatedWidth - margin)),
    top: Math.max(margin, Math.min(clientY + 8, window.innerHeight - estimatedHeight - margin))
  };
}

function closeDialog(result = false) {
  if (!activeDialog) return;

  const { resolve } = activeDialog;
  activeDialog = null;
  dialogOverlayEl.classList.add('hidden');
  dialogOverlayEl.setAttribute('aria-hidden', 'true');
  resolve(result);
}

function showDialog({
  title = '提示',
  message = '',
  confirmText = '确定',
  cancelText = '取消',
  showCancel = true
}) {
  if (activeDialog) {
    activeDialog.resolve(false);
  }

  dialogTitleEl.textContent = title;
  dialogMessageEl.textContent = message;
  dialogConfirmBtnEl.textContent = confirmText;
  dialogCancelBtnEl.textContent = cancelText;
  dialogCancelBtnEl.hidden = !showCancel;
  dialogOverlayEl.classList.remove('hidden');
  dialogOverlayEl.setAttribute('aria-hidden', 'false');

  return new Promise((resolve) => {
    activeDialog = { resolve };
    setTimeout(() => {
      (showCancel ? dialogCancelBtnEl : dialogConfirmBtnEl).focus();
    }, 0);
  });
}

function confirmDialog(message) {
  return showDialog({ title: '提示', message });
}

function alertDialog(message) {
  return showDialog({
    title: '提示',
    message,
    confirmText: '知道了',
    showCancel: false
  });
}

function closeConversationMenu() {
  if (!state.openMenuId) return;

  state.openMenuId = null;
  state.openMenuPosition = null;
  renderList();
}

async function deleteConversation(convo) {
  if (state.deletingConversationId) return;

  state.openMenuId = null;
  state.openMenuPosition = null;
  renderList();

  const confirmed = await confirmDialog(`确认将“${convo.title}”移动到系统回收站吗？`);
  if (!confirmed) return;

  state.deletingConversationId = convo.id;
  renderList();

  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(convo.id)}`, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.error || '删除会话失败');
    }

    await fetchList();
  } catch (error) {
    console.error(error);
    await alertDialog(`删除失败：${error.message}`);
    renderList();
  } finally {
    state.deletingConversationId = null;
    renderList();
  }
}

async function fetchDirectoryState() {
  const res = await fetch('/api/data-directory');
  const data = await res.json();

  state.dataDir = data.dataDir || null;
  directoryInputEl.value = data.dataDir || '';

  if (!data.configured) {
    setDirectoryStatus('未配置文件夹。请输入路径后点击“保存并加载”。');
    return data;
  }

  if (data.error) {
    setDirectoryStatus(`当前已保存路径不可用：${data.error}`, 'error');
    return data;
  }

  setDirectoryStatus(`当前文件夹：${data.dataDir}`, 'success');
  return data;
}

async function fetchList() {
  const res = await fetch('/api/conversations');
  const data = await res.json();

  state.dataDir = data.dataDir || null;
  state.list = data.conversations || [];
  if (!state.list.some((item) => item.id === state.openMenuId)) {
    state.openMenuId = null;
    state.openMenuPosition = null;
  }
  renderList();

  if (!data.configured) {
    resetConversationView('请先输入要读取的文件夹路径。');
    return;
  }

  if (state.list.length > 0) {
    const currentStillExists = state.current && state.list.some((item) => item.id === state.current.id);
    await openConversation(currentStillExists ? state.current.id : state.list[0].id);
    return;
  }

  resetConversationView(`已加载文件夹：${data.dataDir}`);
}

function renderList() {
  listEl.innerHTML = '';

  if (state.list.length === 0) {
    const emptyText = state.dataDir
      ? '当前文件夹没有可用 JSON 文件'
      : '尚未配置 JSON 文件夹';
    listEl.innerHTML = `<div class="empty">${emptyText}</div>`;
    return;
  }

  for (const convo of state.list) {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    if (state.current?.id === convo.id) item.classList.add('active');
    if (state.openMenuId === convo.id) item.classList.add('menu-open');
    if (state.deletingConversationId === convo.id) item.classList.add('deleting');

    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'conversation-main';
    mainBtn.innerHTML = `<div class="title">${escapeHtml(convo.title)}</div>`;

    mainBtn.addEventListener('click', async () => {
      try {
        await openConversation(convo.id);
      } catch (error) {
        console.error(error);
        setDirectoryStatus(`加载会话失败：${error.message}`, 'error');
      }
    });

    const actions = document.createElement('div');
    actions.className = 'conversation-actions';

    const menuTrigger = document.createElement('button');
    menuTrigger.type = 'button';
    menuTrigger.className = 'conversation-menu-trigger';
    menuTrigger.setAttribute('aria-label', `更多操作：${convo.title}`);
    menuTrigger.setAttribute('aria-expanded', state.openMenuId === convo.id ? 'true' : 'false');
    menuTrigger.disabled = state.deletingConversationId === convo.id;
    menuTrigger.innerHTML = '<span></span><span></span><span></span>';
    menuTrigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const nextOpen = state.openMenuId !== convo.id;
      state.openMenuId = state.openMenuId === convo.id ? null : convo.id;
      state.openMenuPosition = nextOpen ? getMenuPosition(event.clientX, event.clientY) : null;
      renderList();
    });

    actions.appendChild(menuTrigger);

    if (state.openMenuId === convo.id) {
      const menu = document.createElement('div');
      menu.className = 'conversation-menu';
      if (state.openMenuPosition) {
        menu.style.left = `${state.openMenuPosition.left}px`;
        menu.style.top = `${state.openMenuPosition.top}px`;
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'conversation-menu-item danger';
      deleteBtn.textContent = state.deletingConversationId === convo.id ? '删除中...' : '删除';
      deleteBtn.disabled = state.deletingConversationId === convo.id;
      deleteBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        await deleteConversation(convo);
      });

      menu.appendChild(deleteBtn);
      actions.appendChild(menu);
    }

    item.append(mainBtn, actions);
    listEl.appendChild(item);
  }
}

async function openConversation(id) {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.detail || data.error || '加载会话失败');
  }

  state.current = data;
  state.selectedByParent = {};
  state.openMenuId = null;
  state.openMenuPosition = null;
  renderList();
  renderConversation();
}

function buildPath() {
  const pathList = [];
  const convo = state.current;
  if (!convo?.startId) return pathList;

  let currentId = convo.startId;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const node = convo.nodes[currentId];
    if (!node) break;
    pathList.push(node);

    if (!node.branchChildren || node.branchChildren.length === 0) break;

    const chosenId = state.selectedByParent[currentId];
    currentId = node.branchChildren.includes(chosenId)
      ? chosenId
      : node.branchChildren[0];

    if (!state.selectedByParent[node.id]) {
      state.selectedByParent[node.id] = currentId;
    }
  }

  return pathList;
}

function renderBranchSwitcher(parentNodeId, branchChildren, switcher) {
  const currentBranchId = branchChildren.includes(state.selectedByParent[parentNodeId])
    ? state.selectedByParent[parentNodeId]
    : branchChildren[0];
  const currentIndex = branchChildren.indexOf(currentBranchId);

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'branch-nav-btn';
  prevBtn.textContent = '<';
  prevBtn.disabled = currentIndex <= 0;
  prevBtn.addEventListener('click', () => {
    if (currentIndex <= 0) return;
    state.selectedByParent[parentNodeId] = branchChildren[currentIndex - 1];
    renderConversation();
  });

  const indexEl = document.createElement('span');
  indexEl.className = 'branch-index';
  indexEl.textContent = `${currentIndex + 1}/${branchChildren.length}`;

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'branch-nav-btn';
  nextBtn.textContent = '>';
  nextBtn.disabled = currentIndex >= branchChildren.length - 1;
  nextBtn.addEventListener('click', () => {
    if (currentIndex >= branchChildren.length - 1) return;
    state.selectedByParent[parentNodeId] = branchChildren[currentIndex + 1];
    renderConversation();
  });

  switcher.append(prevBtn, indexEl, nextBtn);
}

function renderConversation() {
  messagesEl.innerHTML = '';

  if (!state.current || !state.current.startId) {
    messagesEl.innerHTML = '<div class="empty">请尝试其他 JSON 文件</div>';
    return;
  }

  const pathList = buildPath();

  for (const node of pathList) {
    const frag = messageTpl.content.cloneNode(true);
    const card = frag.querySelector('.message-card');
    const meta = frag.querySelector('.message-meta');
    const content = frag.querySelector('.message-content');
    const switcher = frag.querySelector('.branch-switcher');

    card.classList.add(node.role);
    meta.remove();
    content.innerHTML = renderMarkdown(node.text);

    const branchParentId = node.parentOptionsFrom;
    const branchParent = branchParentId ? state.current.nodes[branchParentId] : null;
    if (branchParent && branchParent.branchChildren.length > 1) {
      card.classList.add('has-switcher');
      renderBranchSwitcher(branchParentId, branchParent.branchChildren, switcher);
    }

    messagesEl.appendChild(frag);
  }
}

directoryFormEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  setDirectoryFormDisabled(true);
  setDirectoryStatus('正在保存路径并加载 JSON 文件...');

  try {
    const res = await fetch('/api/data-directory', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ dataDir: directoryInputEl.value })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.error || '保存文件夹失败');
    }

    state.dataDir = data.dataDir || null;
    directoryInputEl.value = data.dataDir || '';
    setDirectoryStatus(`当前文件夹：${data.dataDir}`, 'success');
    await fetchList();
  } catch (error) {
    console.error(error);
    setDirectoryStatus(`保存失败：${error.message}`, 'error');
  } finally {
    setDirectoryFormDisabled(false);
  }
});

clearDirectoryBtnEl.addEventListener('click', async () => {
  setDirectoryFormDisabled(true);
  setDirectoryStatus('正在清空已保存的文件夹路径...');

  try {
    const res = await fetch('/api/data-directory', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ dataDir: '' })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.error || '清空文件夹失败');
    }

    state.dataDir = null;
    state.list = [];
    state.openMenuId = null;
    state.openMenuPosition = null;
    state.deletingConversationId = null;
    directoryInputEl.value = '';
    renderList();
    resetConversationView('请重新输入要读取的文件夹路径。');
    setDirectoryStatus('已清空保存的文件夹路径。');
  } catch (error) {
    console.error(error);
    setDirectoryStatus(`清空失败：${error.message}`, 'error');
  } finally {
    setDirectoryFormDisabled(false);
  }
});

document.addEventListener('click', () => {
  closeConversationMenu();
});

window.addEventListener('resize', () => {
  closeConversationMenu();
});

listEl.addEventListener('scroll', () => {
  closeConversationMenu();
});

dialogOverlayEl.addEventListener('click', (event) => {
  if (event.target === dialogOverlayEl) {
    closeDialog(false);
  }
});

dialogCancelBtnEl.addEventListener('click', () => {
  closeDialog(false);
});

dialogConfirmBtnEl.addEventListener('click', () => {
  closeDialog(true);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (activeDialog) {
      closeDialog(false);
      return;
    }

    closeConversationMenu();
  }
});

async function init() {
  try {
    const directoryState = await fetchDirectoryState();
    if (!directoryState.configured || directoryState.error) {
      renderList();
      resetConversationView('请先输入可读取的文件夹路径。');
      return;
    }

    await fetchList();
  } catch (error) {
    console.error(error);
    setDirectoryStatus(`加载失败：${error.message}`, 'error');
    listEl.innerHTML = `<div class="empty">加载失败：${error.message}</div>`;
    resetConversationView('请检查服务端日志或重新设置文件夹路径。');
  }
}

init();
