# pm2-ui

[简体中文](./README.md) | **English**

Bring the `pm2` process list into your browser and **automatically list the TCP ports each process actually listens on**, labelled with what they are for.

[![npm version](https://img.shields.io/npm/v/pm2-ui)](https://www.npmjs.com/package/pm2-ui)
[![npm downloads](https://img.shields.io/npm/dm/pm2-ui)](https://www.npmjs.com/package/pm2-ui)
![node](https://img.shields.io/badge/node-%3E%3D16-12a150)
![license](https://img.shields.io/badge/license-MIT-blue)

> The dashboard ships with **简体中文 / English**; switch anytime from the top bar — the default follows your browser language.

---

## Start with one command

```bash
npx pm2-ui
```

Or install it globally and run it from any directory:

```bash
npm i -g pm2-ui
pm2-ui
```

After that, type `pm2-ui` in **any directory** and open http://localhost:7799.

> To remove the global command: `npm uninstall -g pm2-ui`

### Run from source (development)

```bash
npm install          # install dependencies (express + pm2, no global pollution)
npm link             # register the pm2-ui global command
```

> To undo the global command: `npm unlink -g pm2-ui`

### Command-line options

```
pm2-ui [options]

  -p, --port <port>     Dashboard port        (default 7799, override with PM2_WEB_PORT)
  -H, --host <addr>     Bind address          (default 127.0.0.1, use 0.0.0.0 for LAN access)
      --pm2 <path>      Path to the pm2 executable (auto-detected by default)
      --open            Open the browser after start
      --demo            Start the demo processes first
      --install         Run npm install automatically when deps are missing
      --check-update    Only check for a new version, change nothing
      --update          Update to the latest version and exit (also available in the dashboard)
  -v, --version         Print the version number
  -h, --help            Show the help
```

Common examples:

```bash
pm2-ui                          # default port
pm2-ui 8080                     # a bare port number works too
pm2-ui --host 0.0.0.0 --open    # LAN access + open the browser
pm2-ui --demo                   # also start 3 demo processes
```

Press `Ctrl+C` to quit. If the port is taken, it tells you which one to use instead:

```
✗ Port 8080 is already in use, try another: pm2-ui --port 8081
```

### Don't want a global command?

The following are equivalent — pick whichever you like:

```bash
npm start          # run inside the project directory (same as node bin/pm2-ui.js)
node bin/pm2-ui.js
```

---

## Features

### 1. Saved apps (recover anything, even after it's gone)

The dashboard is more than a pm2 passthrough: every app's **launch parameters (script, working directory, port, script arguments) are persisted to disk**.

| Scenario | What happens |
| --- | --- |
| You hit "Delete" in the dashboard | pm2 forgets the app, but the parameters are still in the saved-apps list — click "Recover" to bring it back exactly as before |
| The pm2 daemon restarts (version mismatch / `pm2 kill` / machine reboot) | The in-memory process list is wiped, but the saved records survive — recover them one by one |
| You started a process with `pm2 start` in a terminal | The dashboard reverse-engineers the parameters from pm2 and records them, so it is protected too |
| The process is still under pm2 | Shows "Online / Stopped" and lets you restart or stop it directly |

Two extra buttons in the panel map to pm2's native persistence:

- **pm2 save** — runs `pm2 save` to write the current list into `dump.pm2`; every start/stop afterwards also auto-saves (`PM2_UI_AUTOSAVE=0` disables this)
- **Restore all** — runs `pm2 resurrect` to bring back every process recorded in `dump.pm2` at once

Apps whose parameters you edited by hand are marked "curated" and are no longer overwritten by pm2's automatic harvesting.
The saved list lives in `~/.pm2-ui/apps.json` (`PM2_UI_DATA_DIR` changes the location).

> "Remove" is only enabled for apps that pm2 no longer knows about. To purge a record completely: delete it from the process card first, then remove it here.

### 2. Port monitoring (the heart of this project)

For each process, in order:

| Step | What it does | Notes |
| --- | --- | --- |
| ① Find ports | `lsof -nP -iTCP -sTCP:LISTEN -a -p <pid>` | Works on macOS / Linux; falls back to `ss -ltnp` when lsof is missing; Windows uses `netstat -ano` |
| ② Fallback | Reads pm2 environment variables | Reads `PORT` / `SERVER_PORT` / `--port`, useful in containers without lsof |
| ③ Classify | Sends an HTTP GET, then an HTTPS GET if that fails | **Only ports that answer count as web ports**, so MySQL/Redis are never mistaken for web services |

Each port in the panel is labelled:

- `:3101  http  200  http://localhost:3101 ↗` — **HTTP-responsive ports** get a local URL; the whole row is a clickable
  `<a target="_blank" rel="noopener noreferrer">` that opens the service in a new tab
- `:3306  tcp  connection refused while probing` — TCP-only ports with no HTTP response get no link (databases, queues, …)
- "Common middleware port" marker: 22, 3306, 5432, 6379, 27017, 9200… are grouped separately instead of mixing with business ports
- Stopped processes are not probed and are labelled "Process stopped, port not listening"
- When nothing is detected, it says plainly that the process "may not be a network service"

### 3. Process management

Start / stop / restart / reload (zero-downtime) / delete / reset counters — all from the page.

### 4. Live logs

Click "Logs" on a card to open a drawer that streams `pm2 logs` output over SSE; switch between live and snapshot mode.

### 5. Monitoring view

CPU, memory, restart count, uptime, plus a CPU-trend sparkline (the frontend keeps the last 40 samples).

### 6. Self-update

The dashboard is itself an npm package, so it can check and upgrade itself:

- The version number in the top-right corner is the entry point. It turns orange with a "New version" badge when an update exists;
- Open it to see **current version / latest version / which command will run in which directory**; confirm and it updates in one click, with npm output streaming into the modal;
- Afterwards, restart the dashboard to load the new version: if the dashboard is managed by pm2 it runs `pm2 restart` on itself, otherwise it tells you to restart from the terminal (it never silently kills the process).

The install mode is detected automatically, and each mode runs a different command:

| How it runs | Detected as | Update command |
| --- | --- | --- |
| `npm i -g pm2-ui` | Global install | `npm install -g pm2-ui@latest` |
| A project's `node_modules/pm2-ui` | Project dependency | `npm install pm2-ui@latest` in the host project |
| `npx pm2-ui` | Temporary npx run | Cannot update in place — next time run `npx pm2-ui@latest` |
| Running from a git checkout | Source checkout | `git pull --ff-only` + `npm install` |

Two equivalent CLI commands:

```bash
pm2-ui --check-update    # only check the version, change nothing
pm2-ui --update          # update to the latest version (= npm run update)
```

On startup it also prints a one-line hint if a new version exists; set `PM2_UI_AUTO_UPDATE_CHECK=0` to disable that network check (the in-dashboard "Check again" button is unaffected).

### 7. UI language (简体中文 / English)

- The dropdown in the top-right corner switches the language instantly; the choice is stored in the browser and remembered next time;
- On first visit the language is picked from your browser (`zh-*` → Chinese, `en-*` → English, anything else falls back to Chinese);
- Terminal output (CLI help, startup banner, demo script, …) follows `PM2_UI_LANG`, or the system locale (`LC_ALL` / `LC_MESSAGES` / `LANG`) when unset;
- Messages returned by the server are localised per request via `?lang=` or the `Accept-Language` header, so API text matches the dashboard language;
- The demo apps (`--demo`) also follow your browser language.

---

## Configuration

| Environment variable | Default | Description |
| --- | --- | --- |
| `PM2_WEB_PORT` | `7799` | Dashboard port |
| `PM2_WEB_HOST` | `127.0.0.1` | Dashboard bind address; set to `0.0.0.0` for LAN access |
| `PM2_BIN` | auto-detected | Path to the pm2 executable (prefers the bundled `node_modules/.bin/pm2`) |
| `PM2_UI_DATA_DIR` | `~/.pm2-ui` | Where the saved-apps list `apps.json` is stored |
| `PM2_UI_AUTOSAVE` | on | Set to `0` to disable "auto `pm2 save` after an action" |
| `PM2_UI_AUTO_UPDATE_CHECK` | on | Set to `0` to disable the automatic update check on startup (the in-dashboard check still works) |
| `PM2_UI_UPDATE_REGISTRY` | `https://registry.npmjs.org` | Registry used to query versions; can point at a private registry or mirror |
| `PM2_UI_UPDATE_TIMEOUT` | `8000` | Timeout (ms) for fetching the latest version |
| `PM2_UI_LANG` | system locale | UI language: `zh-CN` or `en-US` (used by terminal output and as the API fallback) |

Run the dashboard under pm2 itself:

```bash
npx pm2 start ecosystem.config.js
```

### See it in action quickly

```bash
pm2-ui --demo
```

This starts three demo processes: two web services (3101 / 3102) and a background job that listens on no port — perfect for seeing the difference between the "has a web port" and "no listening port" cards. Clean up with `npm run demo:stop`.

---

## Project layout

```
├── bin/
│   └── pm2-ui.js     # CLI entry (the global pm2-ui command)
├── server/
│   ├── index.js      # Express server + REST API + SSE log stream, exports start()
│   ├── pm2.js        # pm2 CLI wrapper (jlist / restart / logs / save / resurrect…)
│   ├── store.js      # ★ Saved-apps persistence: records launch parameters, rebuilds pm2 start
│   ├── ports.js      # ★ Port probing and classification
│   ├── i18n.js       # ★ Server-side i18n: language resolution + zh/en dictionaries
│   └── update.js     # ★ Self-update: detect install mode, check version, run the update
├── public/           # Frontend (vanilla JS, no build step)
│   ├── index.html
│   ├── style.css
│   ├── i18n.js       # ★ Frontend i18n: language detection, dictionaries, static text
│   └── app.js
├── demo/             # Demo processes: api-server / dashboard / worker
├── scripts/demo.js   # Start/stop the demo processes
├── scripts/dev/      # pm2 test double for environments without a pm2 daemon (not needed at runtime)
├── README.md         # 简体中文
├── README.en.md      # English
└── ecosystem.config.js
```

## API

Any endpoint accepts `?lang=zh-CN|en-US` (or honours `Accept-Language`) to localise the returned messages.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/overview` | PM2 status, system info, aggregate stats, dump status |
| GET | `/api/processes` | Process list (including detected `ports`; HTTP ports carry a `url` field) |
| POST | `/api/processes/:name/:action` | action ∈ start/stop/restart/reload/delete/reset |
| GET | `/api/processes/:name/logs` | Historical log snapshot (stdout / stderr returned separately) |
| GET | `/api/processes/:name/logs/stream` | Live logs (SSE) |
| POST | `/api/start` | Start a new process with `{target, name?, cwd?, port?, args?}` and record it under `name` |
| GET | `/api/apps` | Saved-apps list, with `state` (online / stopped / missing) and a readable `cmd` |
| PUT | `/api/apps/:name` | Create / edit an app definition (marked manual, no longer overwritten by harvesting) |
| POST | `/api/apps/:name/start` | **Start with the saved parameters** — works even after pm2 dropped the app |
| DELETE | `/api/apps/:name` | Remove from the saved-apps list (processes running under pm2 are untouched) |
| POST | `/api/pm2/save` | Runs `pm2 save` and returns the dump status |
| POST | `/api/pm2/resurrect` | Runs `pm2 resurrect` to restore processes from the dump |
| GET | `/api/update/check` | Check the latest version (`?force=1` to bypass the cache), including the detected install mode and update command |
| GET | `/api/update/apply` | Run the self-update and stream the command output over SSE (requires `?confirm=1`) |
| POST | `/api/update/restart` | Restart the dashboard to load the new version (runs `pm2 restart` on itself when pm2-managed) |

---

## Notes and limitations

- Port probing is cached for 20 seconds to avoid hammering `lsof`; the process list itself has a short 1.2-second cache.
- The update check is cached too (every 5 minutes) and **only performs a GET**; it never auto-updates. An actual upgrade requires clicking "Update now" in the dashboard (the endpoint requires `confirm=1`). Only one update can run at a time.
- Self-update touches only `pm2-ui`'s own code — never the business processes running under pm2.
- It binds to `127.0.0.1` by default, because this dashboard can start and stop processes and is effectively a "remote console". If you expose it to a LAN, put a reverse proxy and authentication in front of it.
- `pm2 delete` only removes a process from the pm2 list; it deletes no files.
- **Keep two things apart**: closing and reopening the `pm2-ui` dashboard does not affect the processes running under pm2; what actually makes processes "disappear" is the pm2 daemon being restarted (a different pm2 version, `pm2 kill`, a machine reboot). The saved-apps list exists for exactly that case.
- The saved list is only written to disk when parameters **actually change** (the frontend refreshes every 3 seconds, so it does not rewrite the file constantly); a failed write does not affect the dashboard.
- If `pm2-ui` uses its bundled pm2 while your processes were started by a different pm2 version, the mismatch makes pm2 restart the daemon and clear the list — use "pm2 save" at the top of the panel to write the list into `dump.pm2` first, then restore everything with one click after the restart.

---

## License

[MIT](./LICENSE) © jgblm
