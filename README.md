# ChatGPT Export Reader

一个用于本地阅读 AI 聊天导出 JSON 的小工具（支持树状分支对话切换）。

## 1) 环境要求

- Node.js 18+（推荐 20+）
- npm 9+

## 2) 安装依赖

在项目根目录执行：

```bash
npm install
```

> 如果你在受限网络环境下安装失败（如 `403`），需要切换可用 npm 源或在可访问 npm registry 的网络下执行。

## 3) 启动项目

```bash
npm start
```

默认会启动在：

- `http://localhost:3000`

## 4) 使用方式

1. 把导出的聊天 JSON 文件放到项目目录（默认会读取项目根目录下所有 `.json`）。
2. 启动后打开浏览器访问 `http://localhost:3000`。
3. 左侧选择会话，右侧会以聊天形式展示。
4. 若某条消息存在多个后续分支，会出现“分支切换”下拉框，可手动切换查看不同分支。

## 5) 可选环境变量

- `PORT`：服务端口（默认 `3000`）
- `DATA_DIR`：JSON 数据目录（默认项目根目录）

示例（macOS/Linux）：

```bash
PORT=4000 DATA_DIR=./data npm start
```

示例（Windows PowerShell）：

```powershell
$env:PORT=4000
$env:DATA_DIR=".\\data"
npm start
```

## 6) 常见问题

### Q1: 打开页面没有会话？
确认 `DATA_DIR` 目录中有合法 `.json` 文件，且 JSON 结构中包含 `mapping` 字段。

### Q2: 某些消息没显示？
当前实现会过滤 system/隐藏/空文本节点，只展示可阅读内容。
