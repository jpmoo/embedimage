"""Capture server + worker for the Supernote Embed Image plugin.

Runs a small Flask HTTP server that the plugin polls for the most recent
screen capture. A background thread captures the configured source at a
configurable interval and stashes the latest PNG bytes in memory.

Endpoints
---------
GET  /status                  -> JSON {running, source, interval_sec, ip, ...}
GET  /frame                   -> PNG bytes of the latest captured frame
POST /start                   -> begin capture loop
POST /stop                    -> pause capture loop
POST /source  {source, ...}   -> change capture source (full screen, region, window)
POST /interval {interval_sec} -> change capture interval
POST /adjust  {fade, brightness, contrast, gamma}
                              -> apply tone adjustments to served frames
GET  /windows                 -> JSON list of visible windows from Quartz
"""
from __future__ import annotations

import io
import logging
import socket
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import mss
from flask import Flask, jsonify, request
from PIL import Image, ImageEnhance


# Adjustment ranges must match src/AdjustmentPanel.tsx on the plugin side:
#   fade        0..100  (% blended toward white)
#   brightness -100..100
#   contrast   -100..100
#   gamma       0.2..3.0  (1.0 = identity)
_DEFAULT_ADJUST = {"fade": 0, "brightness": 0, "contrast": 0, "gamma": 1.0}


def _is_identity_adjust(a: dict) -> bool:
    return (
        int(a.get("fade", 0)) == 0
        and int(a.get("brightness", 0)) == 0
        and int(a.get("contrast", 0)) == 0
        and abs(float(a.get("gamma", 1.0)) - 1.0) < 1e-6
    )


def _apply_adjust(img: Image.Image, a: dict) -> Image.Image:
    """Apply brightness/contrast/gamma/fade to an RGB PIL image."""
    if _is_identity_adjust(a):
        return img
    out = img
    brightness = int(a.get("brightness", 0))
    contrast = int(a.get("contrast", 0))
    gamma = float(a.get("gamma", 1.0))
    fade = int(a.get("fade", 0))

    if brightness:
        # -100..100 maps to PIL factor 0..2 (1.0 = unchanged).
        out = ImageEnhance.Brightness(out).enhance(1.0 + brightness / 100.0)
    if contrast:
        out = ImageEnhance.Contrast(out).enhance(1.0 + contrast / 100.0)
    if abs(gamma - 1.0) > 1e-6 and gamma > 0:
        inv = 1.0 / gamma
        lut = [min(255, int(round(255.0 * (i / 255.0) ** inv))) for i in range(256)]
        out = out.point(lut * len(out.getbands()))
    if fade:
        alpha = max(0, min(100, fade)) / 100.0
        white = Image.new("RGB", out.size, (255, 255, 255))
        out = Image.blend(out, white, alpha)
    return out

try:
    import Quartz  # provided by pyobjc-framework-Quartz
    HAS_QUARTZ = True
except ImportError:  # pragma: no cover
    HAS_QUARTZ = False


@dataclass
class CaptureState:
    running: bool = False
    source: str = "screen"  # "screen" | "region" | "window"
    monitor_index: int = 1  # mss is 1-indexed; 1 = primary
    region: Optional[dict] = None  # {x, y, w, h}
    window_id: Optional[int] = None
    interval_sec: float = 1.0
    adjust: dict = field(default_factory=lambda: dict(_DEFAULT_ADJUST))

    last_frame: Optional[bytes] = None
    last_frame_ts: float = 0.0
    frame_count: int = 0
    last_error: Optional[str] = None

    log: list = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)


STATE = CaptureState()


def log(msg: str) -> None:
    with STATE.lock:
        STATE.log.append({"ts": time.time(), "msg": msg})
        if len(STATE.log) > 100:
            STATE.log = STATE.log[-100:]
    print(f"[capture] {msg}", flush=True)


def get_local_ip() -> str:
    """Best-effort LAN IP detection without external services."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"
    finally:
        s.close()


def list_windows() -> list:
    if not HAS_QUARTZ:
        return []
    options = (
        Quartz.kCGWindowListOptionOnScreenOnly
        | Quartz.kCGWindowListExcludeDesktopElements
    )
    windows = Quartz.CGWindowListCopyWindowInfo(options, Quartz.kCGNullWindowID)
    result = []
    for w in windows:
        if w.get("kCGWindowLayer", 1) != 0:
            continue
        bounds = w.get("kCGWindowBounds", {})
        width = int(bounds.get("Width", 0))
        height = int(bounds.get("Height", 0))
        if width < 40 or height < 40:
            continue
        result.append(
            {
                "id": int(w.get("kCGWindowNumber", 0)),
                "owner": w.get("kCGWindowOwnerName", "") or "",
                "title": w.get("kCGWindowName", "") or "",
                "x": int(bounds.get("X", 0)),
                "y": int(bounds.get("Y", 0)),
                "w": width,
                "h": height,
            }
        )
    return result


def _window_bounds(window_id: int) -> Optional[dict]:
    if not HAS_QUARTZ:
        return None
    windows = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionIncludingWindow, window_id
    )
    if not windows:
        return None
    bounds = windows[0].get("kCGWindowBounds", {})
    return {
        "left": int(bounds.get("X", 0)),
        "top": int(bounds.get("Y", 0)),
        "width": int(bounds.get("Width", 0)),
        "height": int(bounds.get("Height", 0)),
    }


def _capture_once(sct: mss.mss) -> Optional[bytes]:
    """Capture according to STATE and return PNG bytes (or None on failure)."""
    target: Optional[dict] = None
    src = STATE.source
    if src == "screen":
        monitors = sct.monitors
        idx = max(1, min(len(monitors) - 1, STATE.monitor_index)) if len(monitors) > 1 else 0
        target = monitors[idx]
    elif src == "region" and STATE.region:
        r = STATE.region
        target = {"left": r["x"], "top": r["y"], "width": r["w"], "height": r["h"]}
    elif src == "window" and STATE.window_id is not None:
        target = _window_bounds(STATE.window_id)
        if target is None or target["width"] == 0 or target["height"] == 0:
            STATE.last_error = "window vanished"
            return None
    else:
        STATE.last_error = "no source"
        return None

    shot = sct.grab(target)
    pil = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    pil = _apply_adjust(pil, dict(STATE.adjust))
    buf = io.BytesIO()
    pil.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def capture_loop() -> None:
    log("capture loop started")
    sct = mss.mss()
    try:
        while True:
            if not STATE.running:
                time.sleep(0.1)
                continue
            try:
                png = _capture_once(sct)
                if png is not None:
                    with STATE.lock:
                        STATE.last_frame = png
                        STATE.last_frame_ts = time.time()
                        STATE.frame_count += 1
                        STATE.last_error = None
            except Exception as e:  # noqa: BLE001
                STATE.last_error = str(e)
                log(f"capture error: {e}")
            time.sleep(max(0.05, STATE.interval_sec))
    finally:
        sct.close()


# ---- Flask app ----

app = Flask(__name__)
# Quiet the per-request access log; we have our own log.
logging.getLogger("werkzeug").setLevel(logging.WARNING)


@app.route("/status")
def status():
    with STATE.lock:
        return jsonify(
            {
                "running": STATE.running,
                "source": STATE.source,
                "monitor_index": STATE.monitor_index,
                "region": STATE.region,
                "window_id": STATE.window_id,
                "interval_sec": STATE.interval_sec,
                "adjust": dict(STATE.adjust),
                "frame_count": STATE.frame_count,
                "has_frame": STATE.last_frame is not None,
                "last_frame_ts": STATE.last_frame_ts,
                "last_error": STATE.last_error,
                "ip": get_local_ip(),
            }
        )


@app.route("/frame")
def frame():
    with STATE.lock:
        if STATE.last_frame is None:
            return jsonify({"error": "no frame"}), 404
        body = STATE.last_frame
    return body, 200, {"Content-Type": "image/png"}


@app.route("/start", methods=["POST"])
def start():
    STATE.running = True
    log("start")
    return jsonify({"ok": True})


@app.route("/stop", methods=["POST"])
def stop():
    STATE.running = False
    log("stop")
    return jsonify({"ok": True})


@app.route("/source", methods=["POST"])
def set_source():
    body: dict[str, Any] = request.get_json(force=True, silent=True) or {}
    src = body.get("source")
    if src not in ("screen", "region", "window"):
        return jsonify({"error": "invalid source"}), 400
    STATE.source = src
    if src == "screen":
        STATE.monitor_index = int(body.get("monitor_index", 1) or 1)
    elif src == "region":
        STATE.region = body.get("region")
    elif src == "window":
        STATE.window_id = int(body.get("window_id") or 0) or None
    log(f"source -> {src} ({body})")
    return jsonify({"ok": True})


@app.route("/interval", methods=["POST"])
def set_interval():
    body = request.get_json(force=True, silent=True) or {}
    try:
        v = float(body.get("interval_sec", 1.0))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid interval"}), 400
    STATE.interval_sec = max(0.05, min(60.0, v))
    log(f"interval -> {STATE.interval_sec}s")
    return jsonify({"ok": True, "interval_sec": STATE.interval_sec})


@app.route("/adjust", methods=["POST"])
def set_adjust():
    body = request.get_json(force=True, silent=True) or {}
    new = dict(_DEFAULT_ADJUST)
    try:
        if "fade" in body:
            new["fade"] = max(0, min(100, int(body["fade"])))
        if "brightness" in body:
            new["brightness"] = max(-100, min(100, int(body["brightness"])))
        if "contrast" in body:
            new["contrast"] = max(-100, min(100, int(body["contrast"])))
        if "gamma" in body:
            new["gamma"] = max(0.2, min(3.0, float(body["gamma"])))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid adjust value"}), 400
    STATE.adjust = new
    log(f"adjust -> {new}")
    return jsonify({"ok": True, "adjust": new})


@app.route("/windows")
def windows():
    return jsonify(list_windows())


def run_server(host: str, port: int) -> None:
    from werkzeug.serving import make_server

    log(f"server listening on http://{host}:{port}")
    server = make_server(host, port, app, threaded=True)
    server.serve_forever()


def start_background(port: int) -> None:
    threading.Thread(target=capture_loop, daemon=True).start()
    threading.Thread(target=run_server, args=("0.0.0.0", port), daemon=True).start()
