const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_PATH = path.join(__dirname, 'data-directory.json');

let currentDataDir = resolveDataDir(process.env.DATA_DIR) || null;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function resolveDataDir(input) {
  if (typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  return path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.normalize(path.resolve(__dirname, trimmed));
}

async function readSavedConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return resolveDataDir(parsed.dataDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeSavedConfig(dataDir) {
  await fs.writeFile(
    CONFIG_PATH,
    `${JSON.stringify({ dataDir }, null, 2)}\n`,
    'utf8'
  );
}

async function assertReadableDirectory(dirPath) {
  const stats = await fs.stat(dirPath);
  if (!stats.isDirectory()) {
    throw new Error('所填路径不是文件夹');
  }

  await fs.readdir(dirPath);
}

function buildDirectoryState(errorMessage = null) {
  return {
    dataDir: currentDataDir,
    configured: Boolean(currentDataDir),
    error: errorMessage
  };
}

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

function toTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getLastDisplayableMessageTime(data) {
  const mapping = data?.mapping || {};
  let lastTime = 0;

  for (const rawNode of Object.values(mapping)) {
    if (!isDisplayable(rawNode)) continue;

    const nodeTime = toTimestamp(rawNode?.message?.create_time);
    if (nodeTime > lastTime) {
      lastTime = nodeTime;
    }
  }

  return lastTime;
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

app.get('/api/data-directory', async (_req, res) => {
  if (!currentDataDir) {
    return res.json(buildDirectoryState());
  }

  try {
    await assertReadableDirectory(currentDataDir);
    return res.json(buildDirectoryState());
  } catch (error) {
    return res.json(buildDirectoryState(error.message));
  }
});

app.post('/api/data-directory', async (req, res) => {
  const nextDataDir = resolveDataDir(req.body?.dataDir);

  try {
    if (nextDataDir) {
      await assertReadableDirectory(nextDataDir);
    }

    currentDataDir = nextDataDir;
    await writeSavedConfig(currentDataDir);
    res.json(buildDirectoryState());
  } catch (error) {
    res.status(400).json({ error: '保存文件夹失败', detail: error.message });
  }
});

app.get('/api/conversations', async (_req, res) => {
  if (!currentDataDir) {
    return res.json({ conversations: [], ...buildDirectoryState() });
  }

  try {
    const files = await fs.readdir(currentDataDir);
    const jsonFiles = files.filter((file) => file.toLowerCase().endsWith('.json'));

    const summaries = [];
    for (const file of jsonFiles) {
      const fullPath = path.join(currentDataDir, file);
      try {
        const raw = await fs.readFile(fullPath, 'utf8');
        const parsed = JSON.parse(raw);
        const lastMessageTime = getLastDisplayableMessageTime(parsed);
        summaries.push({
          id: file,
          title: parsed.title || file,
          createTime: parsed.create_time || null,
          updateTime: parsed.update_time || null,
          lastMessageTime
        });
      } catch {
        // 忽略单个文件解析失败，继续处理其他文件。
      }
    }

    summaries.sort(
      (a, b) =>
        (b.lastMessageTime || b.updateTime || b.createTime || 0) -
        (a.lastMessageTime || a.updateTime || a.createTime || 0)
    );
    res.json({ conversations: summaries, ...buildDirectoryState() });
  } catch (error) {
    res.status(500).json({ error: '读取会话列表失败', detail: error.message });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  if (!currentDataDir) {
    return res.status(400).json({ error: '尚未配置 JSON 文件夹' });
  }

  const fileName = req.params.id;
  if (!fileName.toLowerCase().endsWith('.json')) {
    return res.status(400).json({ error: '仅支持 JSON 文件' });
  }

  const safeBaseDir = path.normalize(`${currentDataDir}${path.sep}`);
  const safePath = path.normalize(path.join(currentDataDir, fileName));
  if (!safePath.startsWith(safeBaseDir)) {
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

async function start() {
  try {
    const savedDataDir = await readSavedConfig();
    if (savedDataDir) {
      currentDataDir = savedDataDir;
    }
  } catch (error) {
    console.error(`Failed to read saved data directory: ${error.message}`);
  }

  app.listen(PORT, () => {
    console.log(`Chat Export Reader running at http://localhost:${PORT}`);
    console.log(`Data directory: ${currentDataDir || '(not configured)'}`);
  });
}

start();
