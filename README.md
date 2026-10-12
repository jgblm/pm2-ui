# pm2-ui

把 `pm2` 的进程列表搬进浏览器，并**自动列出每个进程真正监听的 TCP 端口**，标注端口用途。

[![npm version](https://img.shields.io/npm/v/pm2-ui)](https://www.npmjs.com/package/pm2-ui)
[![npm downloads](https://img.shields.io/npm/dm/pm2-ui)](https://www.npmjs.com/package/pm2-ui)
![node](https://img.shields.io/badge/node-%3E%3D16-12a150)
![license](https://img.shields.io/badge/license-MIT-blue)

---

## 一条命令启动

```bash
npx pm2-ui
```

也可以用 npm 全局安装后任意目录直接运行：

```bash
npm i -g pm2-ui
pm2-ui
```

装完之后在**任意目录**输入 `pm2-ui`，浏览器打开 http://localhost:7799 即可。

> 想卸载全局命令：`npm uninstall -g pm2-ui`

### 从源码运行（开发用）

```bash
npm install          # 装依赖（express + pm2，不污染全局）
npm link             # 把 pm2-ui 注册成全局命令
```

> 想撤销全局命令：`npm unlink -g pm2-ui`

### 命令选项

```
pm2-ui [选项]

  -p, --port <端口>     管理台监听端口        （默认 7799，可用 PM2_WEB_PORT 覆盖）
  -H, --host <地址>     绑定地址              （默认 127.0.0.1，局域网访问用 0.0.0.0）
      --pm2 <路径>      指定 pm2 可执行文件   （默认自动查找）
      --open            启动后自动打开浏览器
      --demo            启动前先拉起演示进程
      --install         缺依赖时自动执行 npm install
  -v, --version         打印版本号
  -h, --help            显示帮助
```

常用例子：

```bash
pm2-ui                          # 默认端口
pm2-ui 8080                     # 直接写端口号也行
pm2-ui --host 0.0.0.0 --open    # 局域网访问 + 自动开浏览器
pm2-ui --demo                   # 顺便起 3 个演示进程看看效果
```

按 `Ctrl+C` 退出。端口被占用时会直接告诉你换哪个：

```
✗ 端口 8080 已被占用，换一个：pm2-ui --port 8081
```

### 不想装全局命令？

以下方式等价，任选其一：

```bash
npm start          # 在项目目录里跑（等价于 node bin/pm2-ui.js）
node bin/pm2-ui.js
```

---

## 核心功能

### 1. 任务清单（任务丢了也能一键恢复）

面板不再只是 pm2 的透传：每个任务的**启动参数（脚本、工作目录、端口、脚本参数）都会落盘保存**。

| 场景 | 会发生什么 |
| --- | --- |
| 你在面板点了「删除」 | pm2 忘掉了这个任务，但任务清单里参数还在，点「恢复启动」即可按原样拉起 |
| pm2 守护进程被重启（版本不符 / `pm2 kill` / 机器重启） | 内存里的进程列表被清空，任务清单里的记录依然在，逐个「恢复启动」即可 |
| 你在终端用 `pm2 start` 起了进程 | 面板会自动从 pm2 反推参数并收录进清单，同样受保护 |
| 进程仍在 pm2 里 | 显示「运行中 / 已停止」，可直接重启、停止 |

面板顶部另有两个按钮，对应 pm2 原生的持久化机制：

- **保存 pm2 列表** —— 执行 `pm2 save`，把当前列表写入 `dump.pm2`；之后每次启停操作也会自动保存（`PM2_UI_AUTOSAVE=0` 可关闭）
- **恢复全部** —— 执行 `pm2 resurrect`，把 `dump.pm2` 里登记的进程一次性全部拉回来

在面板里手工编辑过参数的任务会标记为「已校对」，pm2 的自动收割不会再覆盖它。
任务清单存于 `~/.pm2-ui/apps.json`（用 `PM2_UI_DATA_DIR` 可改位置）。

> 「移除」只对已经不在 pm2 里的任务开放。想彻底清掉一条记录：先在进程卡片里「删除」，再从清单「移除」。

### 2. 端口监控（本项目的重点）

对每个进程依次执行：

| 步骤 | 做法 | 说明 |
| --- | --- | --- |
| ① 找端口 | `lsof -nP -iTCP -sTCP:LISTEN -a -p <pid>` | macOS / Linux 通用；Linux 无 lsof 时退化到 `ss -ltnp`；Windows 用 `netstat -ano` |
| ② 兜底 | 读 pm2 环境变量 | 读 `PORT` / `SERVER_PORT` / 命令行 `--port`，适用于容器里没装 lsof 的情况 |
| ③ 判用途 | 先发 HTTP GET，失败再发 HTTPS GET | **能返回响应才算 Web 端口**，避免把 MySQL、Redis 这类端口误判成网页服务 |

面板上每个端口会标注：

- `:3101  http  200  http://localhost:3101 ↗` —— **可响应 HTTP 的端口**会拼出本地地址，整条是可点击的
  `<a target="_blank" rel="noopener noreferrer">`，点击直接在新标签页打开该服务
- `:3306  tcp  探测时连接被拒` —— 仅 TCP、探测无响应的端口不给链接（数据库 / 队列这类内部服务）
- 「中间件常用端口」标记：22、3306、5432、6379、27017、9200… 单独归类，不会和业务端口混在一起
- 进程处于停止状态时不做探测，标注为「进程已停止，端口未监听」
- 未检测到任何端口时，如实写明"可能不是网络服务"

### 3. 进程管理

启动 / 停止 / 重启 / 重载（reload，零停机）/ 删除 / 重置计数，操作即页面上直接完成。

### 4. 实时日志

点卡片上的「日志」抽屉，通过 SSE 流式推送 `pm2 logs` 输出，可切换实时 / 快照模式。

### 5. 监控视图

CPU、内存、重启次数、运行时长，外加 CPU 趋势迷你折线图（前端保留最近 40 个采样点）。

---

## 常用配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PM2_WEB_PORT` | `7799` | 管理台监听端口 |
| `PM2_WEB_HOST` | `127.0.0.1` | 管理台绑定地址，想局域网访问改成 `0.0.0.0` |
| `PM2_BIN` | 自动查找 | 指定 pm2 可执行文件路径（默认优先用项目内 `node_modules/.bin/pm2`） |
| `PM2_UI_DATA_DIR` | `~/.pm2-ui` | 任务清单 `apps.json` 的存放目录 |
| `PM2_UI_AUTOSAVE` | 开启 | 设为 `0` 关闭「操作后自动 `pm2 save`」 |

用 pm2 托管管理台自己：

```bash
npx pm2 start ecosystem.config.js
```

### 想快速看效果

```bash
pm2-ui --demo
```

会先拉起三个演示进程——两个 Web 服务（3101 / 3102）和一个不监听任何端口的后台任务，
正好能看出「有 Web 端口」「无监听端口」两种卡片的区别。用 `npm run demo:stop` 清理。

---

## 目录结构

```
├── bin/
│   └── pm2-ui.js     # 命令行入口（全局命令 pm2-ui）
├── server/
│   ├── index.js      # Express 服务 + REST API + SSE 日志流，导出 start()
│   ├── pm2.js        # pm2 CLI 封装（jlist / restart / logs / save / resurrect…）
│   ├── store.js      # ★ 任务清单持久化：收录启动参数、还原 pm2 start 命令
│   └── ports.js      # ★ 端口探测与用途判定
├── public/           # 前端（原生 JS，无构建步骤）
├── demo/             # 演示进程：api-server / dashboard / worker
├── scripts/demo.js   # 演示进程一键启停
├── scripts/dev/      # 仅用于无 pm2 守护进程环境的自测替身，运行时不依赖
└── ecosystem.config.js
```

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/overview` | PM2 状态、系统信息、汇总统计、dump 状态 |
| GET | `/api/processes` | 进程列表（含探测到的 `ports`，HTTP 端口带 `url` 字段） |
| POST | `/api/processes/:name/:action` | action ∈ start/stop/restart/reload/delete/reset |
| GET | `/api/processes/:name/logs` | 历史日志快照（stdout / stderr 分开返回） |
| GET | `/api/processes/:name/logs/stream` | 实时日志（SSE） |
| POST | `/api/start` | 启动新进程 `{target, name?, cwd?, port?, args?}`，并按 `name` 记入任务清单 |
| GET | `/api/apps` | 任务清单，附带与 pm2 对照后的 `state`（online / stopped / missing）与可读命令 `cmd` |
| PUT | `/api/apps/:name` | 新增 / 编辑任务定义（标记为 manual，不再被自动收割覆盖） |
| POST | `/api/apps/:name/start` | **按保存的参数启动** —— pm2 丢掉该任务后依然可用 |
| DELETE | `/api/apps/:name` | 从任务清单移除（不动 pm2 里正在跑的进程） |
| POST | `/api/pm2/save` | 执行 `pm2 save`，返回 dump 状态 |
| POST | `/api/pm2/resurrect` | 执行 `pm2 resurrect`，按 dump 恢复进程 |

---

## 说明与边界

- 端口探测每 20 秒缓存一次，避免频繁 `lsof`；进程列表本身有 1.2 秒短缓存。
- 默认只绑定 `127.0.0.1`，因为这个面板可以启停进程、相当于一个"远程控制台"。若要暴露到局域网，请自行加一层反向代理与鉴权。
- `pm2 delete` 只把进程移出 pm2 列表，不会删除任何文件。
- **两件事要分清**：关掉再打开 `pm2-ui` 面板本身，不影响 pm2 里跑着的进程；真正会让进程"消失"的是 pm2 守护进程被重启（例如换用不同版本的 pm2、`pm2 kill`、机器重启）。任务清单针对的正是后一种情况。
- 任务清单只在参数**真的发生变化**时写盘（前端每 3 秒刷新一次，不会反复写文件）；写盘失败也不会影响面板主流程。
- 如果 `pm2-ui` 用的是项目内自带 pm2、而你的进程是另一版本 pm2 起的，两者版本不一致会让 pm2 重启守护进程并清空列表 —— 用面板顶部的「保存 pm2 列表」先把列表落进 `dump.pm2`，即可在重启后一键「恢复全部」。

---

## License

[MIT](./LICENSE) © jgblm
