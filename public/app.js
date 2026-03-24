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

let md = null;

function escapeHtml(input) {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function renderMarkdown(markdown) {
  if (!markdown) return '';

  if (!window.markdownit || !window.DOMPurify) {
    return `<p>${escapeHtml(markdown).replaceAll('\n', '<br>')}</p>`;
  }

  if (!md) {
    md = window.markdownit({ html: false, linkify: true, breaks: true });
  }

  const raw = md.render(markdown);
  return window.DOMPurify.sanitize(raw);
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
