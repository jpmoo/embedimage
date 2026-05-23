# Supernote Screen-Capture Server (Mac)

Streams a screen / region / window from your Mac to the **Live Capture**
screen of the Embed Image plugin on a Supernote Manta. The plugin polls
this app over HTTP on the LAN — 1 frame per second by default.

## Run

```bash
./macapp/run.sh
```

The script creates a `macapp/.venv`, installs `requirements.txt`, and
launches the Tk window. On first run macOS will prompt for **Screen
Recording** permission — grant it in System Settings → Privacy & Security
→ Screen & System Audio Recording, then relaunch.

The window shows:

- **Connection** — your LAN IP and port. Copy these into the Manta plugin
  via Settings → Mac Capture Server.
- **Source** — Full screen, a draggable region, or a specific window from
  Quartz's window list (click *Refresh* if you opened a new app).
- **Interval** — seconds per frame (0.2 .. 10). The plugin polls at its
  own interval; the lower of the two effectively wins.
- **Start / Stop** — toggle the capture loop. Frames are kept in memory
  only; no disk writes.
- **Log** — running activity from both server and GUI.

Custom port:

```bash
./macapp/run.sh --port 9100
```

## HTTP API (for debugging)

| Path        | Method | Body                                           |
|-------------|--------|------------------------------------------------|
| `/status`   | GET    | —                                              |
| `/frame`    | GET    | latest PNG                                     |
| `/start`    | POST   | —                                              |
| `/stop`     | POST   | —                                              |
| `/source`   | POST   | `{source: "screen"\|"region"\|"window", ...}`  |
| `/interval` | POST   | `{interval_sec: 1.0}`                          |
| `/windows`  | GET    | list of visible windows                        |

`curl http://<your-ip>:9000/status` from the Mac confirms the server is
reachable before you point the plugin at it.

## Why these libraries

- **mss** — fast, no-fuss screen capture; works on macOS without Quartz
  context juggling for full-screen / region grabs.
- **pyobjc-framework-Quartz** — enumerates visible windows so you can pick
  by app/title instead of memorising rect coordinates.
- **Pillow** — PNG encoding of the captured frame.
- **Flask** — small HTTP surface served from a worker thread alongside the
  Tk main loop.
