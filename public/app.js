const state = {
  list: [],
  current: null,
  selectedByParent: {}
};

const listEl = document.getElementById('conversation-list');
const titleEl = document.getElementById('chat-title');
const messagesEl = document.getElementById('chat-messages');
const messageTpl = document.getElementById('message-template');

function fmtTime(ts) {
  if (!ts) return '未知时间';
  return new Date(ts * 1000).toLocaleString('zh-CN');
}

function roleLabel(role) {
  if (role === 'user') return '你';
  if (role === 'assistant') return '助手';
  return role;
}

function escapeHtml(input) {
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

  html = html.replace(/(?:^|\n)([-*])\s+(.+)(?=\n|$)/g, (match, _marker, item, offset, source) => {
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

async function fetchList() {
  const res = await fetch('/api/conversations');
  const data = await res.json();
  state.list = data.conversations || [];
  renderList();

  if (state.list.length > 0) {
    await openConversation(state.list[0].id);
  }
}

function renderList() {
  listEl.innerHTML = '';

  if (state.list.length === 0) {
    listEl.innerHTML = '<div class="empty">当前目录没有可用 JSON 文件</div>';
    return;
  }

  for (const convo of state.list) {
    const btn = document.createElement('button');
    btn.className = 'conversation-item';
    if (state.current?.id === convo.id) btn.classList.add('active');

    btn.innerHTML = `
      <div class="title">${convo.title}</div>
      <div class="time">更新: ${fmtTime(convo.updateTime)}</div>
    `;

    btn.addEventListener('click', () => openConversation(convo.id));
    listEl.appendChild(btn);
  }
}

async function openConversation(id) {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
  const data = await res.json();

  state.current = data;
  state.selectedByParent = {};
  renderList();
  renderConversation();
}

function buildPath() {
  const path = [];
  const convo = state.current;
  if (!convo?.startId) return path;

  let currentId = convo.startId;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const node = convo.nodes[currentId];
    if (!node) break;
    path.push(node);

    if (!node.branchChildren || node.branchChildren.length === 0) break;

    const chosenId = state.selectedByParent[currentId];
    currentId = node.branchChildren.includes(chosenId)
      ? chosenId
      : node.branchChildren[0];

    if (!state.selectedByParent[node.id]) {
      state.selectedByParent[node.id] = currentId;
    }
  }

  return path;
}

function renderConversation() {
  messagesEl.innerHTML = '';

  if (!state.current || !state.current.startId) {
    titleEl.textContent = '该文件未找到可展示消息';
    messagesEl.innerHTML = '<div class="empty">请尝试其他 JSON 文件</div>';
    return;
  }

  titleEl.textContent = state.current.title;
  const path = buildPath();

  for (const node of path) {
    const frag = messageTpl.content.cloneNode(true);
    const card = frag.querySelector('.message-card');
    const meta = frag.querySelector('.message-meta');
    const content = frag.querySelector('.message-content');
    const switcher = frag.querySelector('.branch-switcher');

    card.classList.add(node.role);
    meta.textContent = `${roleLabel(node.role)} · ${fmtTime(node.createTime)}`;
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

fetchList().catch((error) => {
  console.error(error);
  listEl.innerHTML = `<div class="empty">加载失败: ${error.message}</div>`;
});
