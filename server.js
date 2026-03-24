const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;

app.use(express.static(path.join(__dirname, 'public')));

function getRole(node) {
  return node?.message?.author?.role || 'unknown';
}

function getText(node) {
  const content = node?.message?.content;
  if (!content) return '';

  if (Array.isArray(content.parts)) {
    return content.parts.filter(Boolean).join('\n\n').trim();
  }

  if (typeof content.text === 'string') {
    return content.text.trim();
  }

  return '';
}

function isDisplayable(node) {
  if (!node?.message) return false;
  if (node.message.metadata?.is_visually_hidden_from_conversation) return false;

  const role = getRole(node);
  if (role === 'system') return false;

  return getText(node).length > 0;
}

function collectFirstDisplayable(rawId, mapping) {
  const node = mapping[rawId];
  if (!node) return [];

  if (isDisplayable(node)) {
    return [rawId];
  }

  const result = [];
  for (const childId of node.children || []) {
    result.push(...collectFirstDisplayable(childId, mapping));
  }
  return result;
}

function normalizeConversation(data, fileName) {
  const mapping = data.mapping || {};
  const nodes = {};

  for (const [id, rawNode] of Object.entries(mapping)) {
    if (!isDisplayable(rawNode)) continue;

    nodes[id] = {
      id,
      role: getRole(rawNode),
      text: getText(rawNode),
      createTime: rawNode.message.create_time || null,
      parentOptionsFrom: null,
      branchChildren: []
    };
  }

  const roots = Object.values(mapping)
    .filter((node) => node.parent === null)
    .map((node) => node.id);

  const startCandidates = roots.flatMap((id) => collectFirstDisplayable(id, mapping));
  const startId = startCandidates[0] || null;

  for (const [displayId, node] of Object.entries(nodes)) {
    const rawNode = mapping[displayId];
    const branchChildren = [];

    for (const childRawId of rawNode.children || []) {
      const candidates = collectFirstDisplayable(childRawId, mapping);
      for (const candidate of candidates) {
        if (!branchChildren.includes(candidate)) {
          branchChildren.push(candidate);
        }
      }
    }

    node.branchChildren = branchChildren.filter((id) => nodes[id]);
    for (const childId of node.branchChildren) {
      if (!nodes[childId].parentOptionsFrom) {
        nodes[childId].parentOptionsFrom = displayId;
      }
    }
  }

  return {
    id: fileName,
    title: data.title || fileName,
    createTime: data.create_time || null,
    updateTime: data.update_time || null,
    startId,
    nodes
  };
}

app.get('/api/conversations', async (_req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const jsonFiles = files.filter((file) => file.toLowerCase().endsWith('.json'));

    const summaries = [];
    for (const file of jsonFiles) {
      const fullPath = path.join(DATA_DIR, file);
      try {
        const raw = await fs.readFile(fullPath, 'utf8');
        const parsed = JSON.parse(raw);
        summaries.push({
          id: file,
          title: parsed.title || file,
          createTime: parsed.create_time || null,
          updateTime: parsed.update_time || null
        });
      } catch {
        // 忽略单个文件解析失败，继续处理其余文件。
      }
    }

    summaries.sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0));
    res.json({ conversations: summaries });
  } catch (error) {
    res.status(500).json({ error: '读取会话列表失败', detail: error.message });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  const fileName = req.params.id;
  if (!fileName.toLowerCase().endsWith('.json')) {
    return res.status(400).json({ error: '仅支持 JSON 文件' });
  }

  const safePath = path.normalize(path.join(DATA_DIR, fileName));
  if (!safePath.startsWith(path.normalize(DATA_DIR + path.sep))) {
    return res.status(400).json({ error: '非法路径' });
  }

  try {
    const raw = await fs.readFile(safePath, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalizeConversation(parsed, fileName);
    res.json(normalized);
  } catch (error) {
    res.status(500).json({ error: '读取会话失败', detail: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Chat Export Reader running at http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
