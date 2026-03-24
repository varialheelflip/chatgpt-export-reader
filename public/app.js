const state = {
  list: [],
  current: null,
  selectedByParent: {},
  dataDir: null
};

const listEl = document.getElementById('conversation-list');
const titleEl = document.getElementById('chat-title');
const messagesEl = document.getElementById('chat-messages');
const messageTpl = document.getElementById('message-template');
const directoryFormEl = document.getElementById('directory-form');
const directoryInputEl = document.getElementById('directory-input');
const saveDirectoryBtnEl = document.getElementById('save-directory-btn');
const clearDirectoryBtnEl = document.getElementById('clear-directory-btn');
const directoryStatusEl = document.getElementById('directory-status');

function roleLabel(role) {
  if (role === 'user') return '用户';
  if (role === 'assistant') return '助手';
  return role;
}

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
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

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

function resetConversationView(title, message) {
  state.current = null;
  state.selectedByParent = {};
  titleEl.textContent = title;
  messagesEl.innerHTML = `<div class="empty">${message}</div>`;
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
  renderList();

  if (!data.configured) {
    resetConversationView('未配置 JSON 文件夹', '请先输入要读取的文件夹路径。');
    return;
  }

  if (state.list.length > 0) {
    const currentStillExists = state.current && state.list.some((item) => item.id === state.current.id);
    await openConversation(currentStillExists ? state.current.id : state.list[0].id);
    return;
  }

  resetConversationView('当前文件夹没有 JSON 文件', `已加载文件夹：${data.dataDir}`);
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
    const btn = document.createElement('button');
    btn.className = 'conversation-item';
    if (state.current?.id === convo.id) btn.classList.add('active');
    btn.innerHTML = `<div class="title">${convo.title}</div>`;

    btn.addEventListener('click', async () => {
      try {
        await openConversation(convo.id);
      } catch (error) {
        console.error(error);
        setDirectoryStatus(`加载会话失败：${error.message}`, 'error');
      }
    });

    listEl.appendChild(btn);
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

function renderConversation() {
  messagesEl.innerHTML = '';

  if (!state.current || !state.current.startId) {
    titleEl.textContent = '该文件未找到可展示消息';
    messagesEl.innerHTML = '<div class="empty">请尝试其他 JSON 文件</div>';
    return;
  }

  titleEl.textContent = state.current.title;
  const pathList = buildPath();

  for (const node of pathList) {
    const frag = messageTpl.content.cloneNode(true);
    const card = frag.querySelector('.message-card');
    const meta = frag.querySelector('.message-meta');
    const content = frag.querySelector('.message-content');
    const switcher = frag.querySelector('.branch-switcher');

    card.classList.add(node.role);
    meta.textContent = roleLabel(node.role);
    content.innerHTML = renderMarkdown(node.text);

    if (node.branchChildren.length > 1) {
      const select = document.createElement('select');
      node.branchChildren.forEach((childId, idx) => {
        const option = document.createElement('option');
        option.value = childId;
        option.textContent = `分支 ${idx + 1}/${node.branchChildren.length}`;
        select.appendChild(option);
      });

      select.value = state.selectedByParent[node.id] || node.branchChildren[0];
      select.addEventListener('change', () => {
        state.selectedByParent[node.id] = select.value;
        renderConversation();
      });

      const label = document.createElement('div');
      label.className = 'message-meta';
      label.textContent = '切换该节点后的分支：';
      switcher.append(label, select);
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
    directoryInputEl.value = '';
    renderList();
    resetConversationView('未配置 JSON 文件夹', '请重新输入要读取的文件夹路径。');
    setDirectoryStatus('已清空保存的文件夹路径。');
  } catch (error) {
    console.error(error);
    setDirectoryStatus(`清空失败：${error.message}`, 'error');
  } finally {
    setDirectoryFormDisabled(false);
  }
});

async function init() {
  try {
    const directoryState = await fetchDirectoryState();
    if (!directoryState.configured || directoryState.error) {
      renderList();
      resetConversationView('未配置 JSON 文件夹', '请先输入可读取的文件夹路径。');
      return;
    }

    await fetchList();
  } catch (error) {
    console.error(error);
    setDirectoryStatus(`加载失败：${error.message}`, 'error');
    listEl.innerHTML = `<div class="empty">加载失败：${error.message}</div>`;
    resetConversationView('加载失败', '请检查服务端日志或重新设置文件夹路径。');
  }
}

init();
