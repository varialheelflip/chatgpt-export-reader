# ChatGPT Export Reader

一个用于本地阅读 AI 聊天导出 JSON 的小工具，支持树状分支对话切换。

## 1) 环境要求

- Node.js 18+，推荐 20+
- npm 9+

## 2) 安装依赖

在项目根目录执行：

```bash
npm install
```

## 3) 启动项目

```bash
npm start
```

默认访问地址：

- `http://localhost:3000`

## 4) 使用方式

1. 启动后打开 `http://localhost:3000`
2. 在左侧输入 JSON 文件夹路径，点击“保存并加载”
3. 程序会把该路径保存到项目根目录的 `data-directory.json`
4. 服务重启后会默认恢复上次保存的路径
5. 左侧选择会话，右侧按聊天形式展示内容
6. 若某条消息存在多个后续分支，会显示分支切换下拉框

> 普通浏览器页面无法稳定获取并持久化系统文件夹的绝对路径，所以当前版本采用“后端配置文件保存目录”的方式实现。

## 5) 可选环境变量

- `PORT`：服务端口，默认 `3000`
- `DATA_DIR`：初始 JSON 数据目录。仅在尚未生成 `data-directory.json` 时作为启动默认值

macOS/Linux 示例：

```bash
PORT=4000 DATA_DIR=./data npm start
```

Windows PowerShell 示例：

```powershell
$env:PORT=4000
$env:DATA_DIR=".\\data"
npm start
```

## 6) 常见问题

### Q1: 打开页面没有会话？

确认已经在页面上保存了 JSON 文件夹路径，且该目录中存在合法 `.json` 文件，并且 JSON 结构包含 `mapping` 字段。

### Q2: 某些消息没有显示？

当前实现会过滤 `system`、隐藏节点和空文本节点，只显示可阅读内容。
