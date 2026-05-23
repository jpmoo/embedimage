"""Capture server + worker for the Supernote Embed Image plugin.

Runs a small Flask HTTP server that the plugin polls for the most recent
screen capture. A background thread captures the configured source at a
configurable interval and stashes the latest PNG bytes in memory.

Endpoints
---------
GET  /status                   -> JSON {running, source, interval_sec, ip, ...}
GET  /frame                    -> PNG bytes of the latest captured frame
POST /start                    -> begin capture loop
POST /stop                     -> pause capture loop
POST /source  {source, ...}    -> change capture source (full screen, region, window)
POST /interval {interval_sec}  -> change capture interval
POST /adjust  {fade, brightness, contrast, gamma, dither}
                               -> apply tone adjustments to served frames
POST /resolution {mul}         -> downscale factor (0.1..1.0) applied to frames
GET  /windows                  -> JSON list of visible windows from Quartz
GET  /preview-shot?max=600     -> one-off PNG screenshot of the primary
                                  monitor for the Manta-side region picker
POST /birefnet                 -> request body is PNG image bytes; response
                                  is PNG with background removed (composited
                                  onto white). Requires `torch` and
                                  `transformers` to be installed.
GET  /drop/list                -> JSON list of files dropped into the watch
                                  folder, newest first
GET  /drop/file?name=<name>    -> binary content of a dropped file
POST /drop/consume {name}      -> mark a dropped file as consumed (renames
                                  it out of the watch folder)
POST /sketch                   -> request body is PNG bytes (a lasso export
                                  from the Manta); saves to ~/Drop with a
                                  timestamped filename so the user can pick
                                  it up
GET  /presets                  -> JSON list of named adjustment presets
POST /presets  {name, ...}     -> save a preset (overwrites by name)
DELETE /presets/<name>         -> remove a preset
"""
from __future__ import annotations

import io
import json
import logging
import os
import socket
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import mss
from flask import Flask, jsonify, request, send_file
from PIL import Image, ImageEnhance

# Persisted data lives here. Watch folder is what users drop / airdrop
# files into; presets file holds named adjustment combos.
DATA_DIR = Path.home() / "EmbedImage"
WATCH_DIR = DATA_DIR / "Drop"
CONSUMED_DIR = DATA_DIR / "Drop" / ".consumed"
PRESETS_PATH = DATA_DIR / "presets.json"
SKETCHES_DIR = DATA_DIR / "Sketches"
for _d in (DATA_DIR, WATCH_DIR, CONSUMED_DIR, SKETCHES_DIR):
    _d.mkdir(parents=True, exist_ok=True)

DROP_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp", ".tiff", ".tif"}


# Adjustment ranges must match src/AdjustmentPanel.tsx on the plugin side:
#   fade        0..100  (% blended toward white)
#   brightness -100..100
#   contrast   -100..100
#   gamma       0.2..3.0  (1.0 = identity)
#   dither      "none" | "fs1" | "fs4" | "atkinson"  (Manta has 4-level gray)
_DEFAULT_ADJUST = {
    "fade": 0,
    "brightness": 0,
    "contrast": 0,
    "gamma": 1.0,
    "dither": "none",
}


def _is_identity_adjust(a: dict) -> bool:
    return (
        int(a.get("fade", 0)) == 0
        and int(a.get("brightness", 0)) == 0
        and int(a.get("contrast", 0)) == 0
        and abs(float(a.get("gamma", 1.0)) - 1.0) < 1e-6
        and str(a.get("dither", "none")) == "none"
    )


def _dither(img: Image.Image, mode: str) -> Image.Image:
    """Quantize to a small palette using error-diffusion. PIL's built-in
    Floyd-Steinberg via convert('1') / convert('P') is fine for most;
    we expose 1-bit ('fs1') and 4-level grayscale ('fs4', the Manta's
    native range) and Atkinson (classic Mac-look) implemented manually."""
    if mode == "fs1":
        return img.convert("L").convert("1").convert("RGB")
    if mode == "fs4":
        # 4-level gray palette (black, dark gray, light gray, white).
        pal_img = Image.new("P", (1, 1))
        pal = [0, 0, 0, 85, 85, 85, 170, 170, 170, 255, 255, 255] + [0] * (256 * 3 - 12)
        pal_img.putpalette(pal)
        g = img.convert("L").convert("RGB")
        return g.quantize(palette=pal_img, dither=Image.FLOYDSTEINBERG).convert("RGB")
    if mode == "atkinson":
        import numpy as np

        arr = np.asarray(img.convert("L"), dtype=np.float32).copy()
        h, w = arr.shape
        for y in range(h):
            for x in range(w):
                old = arr[y, x]
                new = 0.0 if old < 128 else 255.0
                arr[y, x] = new
                err = (old - new) / 8.0
                for dx, dy in ((1, 0), (2, 0), (-1, 1), (0, 1), (1, 1), (0, 2)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        arr[ny, nx] += err
        return Image.fromarray(arr.clip(0, 255).astype("uint8"), "L").convert("RGB")
    return img


def _apply_adjust(img: Image.Image, a: dict) -> Image.Image:
    """Apply brightness/contrast/gamma/fade/dither to an RGB PIL image."""
    if _is_identity_adjust(a):
        return img
    out = img
    brightness = int(a.get("brightness", 0))
    contrast = int(a.get("contrast", 0))
    gamma = float(a.get("gamma", 1.0))
    fade = int(a.get("fade", 0))
    dither = str(a.get("dither", "none"))

    if brightness:
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
    if dither and dither != "none":
        out = _dither(out, dither)
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
    resolution_mul: float = 1.0  # downscale factor applied to outgoing frames
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
    mul = max(0.05, min(1.0, STATE.resolution_mul))
    if mul < 0.999:
        new_w = max(1, int(round(pil.width * mul)))
        new_h = max(1, int(round(pil.height * mul)))
        pil = pil.resize((new_w, new_h), Image.LANCZOS)
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


def _primary_monitor() -> dict:
    with mss.mss() as sct:
        monitors = sct.monitors
        mon = monitors[1] if len(monitors) > 1 else monitors[0]
        return {
            "left": int(mon["left"]),
            "top": int(mon["top"]),
            "width": int(mon["width"]),
            "height": int(mon["height"]),
        }


@app.route("/status")
def status():
    mon = _primary_monitor()
    with STATE.lock:
        return jsonify(
            {
                "running": STATE.running,
                "source": STATE.source,
                "monitor_index": STATE.monitor_index,
                "region": STATE.region,
                "window_id": STATE.window_id,
                "interval_sec": STATE.interval_sec,
                "resolution_mul": STATE.resolution_mul,
                "adjust": dict(STATE.adjust),
                "frame_count": STATE.frame_count,
                "has_frame": STATE.last_frame is not None,
                "last_frame_ts": STATE.last_frame_ts,
                "last_error": STATE.last_error,
                "ip": get_local_ip(),
                "monitor": mon,
                "drop_count": len(_drop_list()),
                "watch_folder": str(WATCH_DIR),
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


_VALID_DITHER = {"none", "fs1", "fs4", "atkinson"}


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
        if "dither" in body:
            d = str(body["dither"] or "none")
            new["dither"] = d if d in _VALID_DITHER else "none"
    except (TypeError, ValueError):
        return jsonify({"error": "invalid adjust value"}), 400
    STATE.adjust = new
    log(f"adjust -> {new}")
    return jsonify({"ok": True, "adjust": new})


@app.route("/resolution", methods=["POST"])
def set_resolution():
    body = request.get_json(force=True, silent=True) or {}
    try:
        v = float(body.get("mul", body.get("resolution_mul", 1.0)))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid resolution"}), 400
    STATE.resolution_mul = max(0.1, min(1.0, v))
    log(f"resolution -> {STATE.resolution_mul:.2f}")
    return jsonify({"ok": True, "resolution_mul": STATE.resolution_mul})


@app.route("/windows")
def windows():
    return jsonify(list_windows())


@app.route("/preview-shot")
def preview_shot():
    """Single screenshot for the Manta region picker. Always full primary
    monitor (no adjustments, no resolution mul applied), downscaled to a
    max dimension. Response: PNG bytes.

    Headers:
        X-Mon-Left / X-Mon-Top / X-Mon-Width / X-Mon-Height  (mac pixels)
        X-Scale                                              (preview / mac)

    Query:
        max  preview max dimension (default 600)
    """
    try:
        max_dim = int(request.args.get("max", "600"))
    except (TypeError, ValueError):
        max_dim = 600
    max_dim = max(160, min(2000, max_dim))

    with mss.mss() as sct:
        monitors = sct.monitors
        mon = monitors[1] if len(monitors) > 1 else monitors[0]
        shot = sct.grab(mon)
    pil = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
    long_side = max(pil.width, pil.height)
    scale = max_dim / long_side if long_side > max_dim else 1.0
    if scale < 0.999:
        pil = pil.resize(
            (max(1, int(pil.width * scale)), max(1, int(pil.height * scale))),
            Image.LANCZOS,
        )
    buf = io.BytesIO()
    pil.save(buf, format="PNG", optimize=False)
    headers = {
        "Content-Type": "image/png",
        "X-Mon-Left": str(int(mon["left"])),
        "X-Mon-Top": str(int(mon["top"])),
        "X-Mon-Width": str(int(mon["width"])),
        "X-Mon-Height": str(int(mon["height"])),
        "X-Scale": f"{scale:.6f}",
    }
    return buf.getvalue(), 200, headers


# ---- BiRefNet background removal (lazy-loaded) ----

_BIREFNET = None  # cached {model, processor, device}
_BIREFNET_LOCK = threading.Lock()


def _load_birefnet():
    """Import torch/transformers lazily and cache the model. Returns the
    cached dict on success or raises with a friendly message."""
    global _BIREFNET
    with _BIREFNET_LOCK:
        if _BIREFNET is not None:
            return _BIREFNET
        try:
            import torch  # type: ignore
            from transformers import AutoModelForImageSegmentation  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "BiRefNet needs torch+transformers. Install with:\n"
                "  pip install torch torchvision transformers"
            ) from e
        log("loading BiRefNet (first call only — may take a while)…")
        model = AutoModelForImageSegmentation.from_pretrained(
            "ZhengPeng7/BiRefNet", trust_remote_code=True
        )
        device = (
            "mps" if torch.backends.mps.is_available()
            else "cuda" if torch.cuda.is_available()
            else "cpu"
        )
        # The published weights ship in fp16; on MPS this trips a
        # "Input type (float) and bias type (c10::Half) should be the
        # same" mismatch because torchvision's transforms produce fp32
        # tensors. Force the whole model to fp32 — it's a few hundred
        # MB instead of a few hundred, and accuracy is unchanged.
        model = model.to(torch.float32).to(device).eval()
        log(f"BiRefNet ready on {device} (fp32)")
        _BIREFNET = {"model": model, "device": device, "torch": torch}
        return _BIREFNET


def _birefnet_remove(img: Image.Image, bg: str) -> Image.Image:
    """Run BiRefNet; composite onto white (bg='white') or keep alpha
    (bg='transparent')."""
    state = _load_birefnet()
    torch = state["torch"]
    model = state["model"]
    device = state["device"]
    from torchvision import transforms  # local import; torchvision came with torch

    tfm = transforms.Compose([
        transforms.Resize((1024, 1024)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    rgb = img.convert("RGB")
    model_dtype = next(model.parameters()).dtype
    inp = tfm(rgb).unsqueeze(0).to(device=device, dtype=model_dtype)
    with torch.no_grad():
        preds = model(inp)[-1].sigmoid().to(dtype=torch.float32).cpu()
    mask = preds[0].squeeze()
    from PIL import Image as PI
    mask_pil = transforms.ToPILImage()(mask).resize(rgb.size, PI.BILINEAR)
    out = rgb.copy()
    out.putalpha(mask_pil)
    if bg == "transparent":
        return out
    flat = Image.new("RGB", out.size, (255, 255, 255))
    flat.paste(out, mask=out.split()[3])
    return flat


@app.route("/birefnet", methods=["POST"])
def birefnet():
    """Body: raw image bytes (PNG/JPEG/etc).
    Query: bg=white (default) | transparent."""
    bg = request.args.get("bg", "white").lower()
    if bg not in ("white", "transparent"):
        bg = "white"
    raw = request.get_data(cache=False)
    if not raw:
        return jsonify({"error": "no image body"}), 400
    try:
        src = Image.open(io.BytesIO(raw))
        src.load()
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"decode failed: {e}"}), 400
    try:
        out = _birefnet_remove(src, bg)
    except RuntimeError as e:
        log(f"birefnet not available: {e}")
        return jsonify({"error": str(e)}), 503
    except Exception as e:  # noqa: BLE001
        log(f"birefnet error: {e}")
        return jsonify({"error": f"birefnet failed: {e}"}), 500
    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=False)
    return buf.getvalue(), 200, {"Content-Type": "image/png"}


# ---- Watch folder (drop / airdrop area) ----

def _drop_list() -> list:
    items = []
    for p in WATCH_DIR.iterdir():
        if not p.is_file():
            continue
        if p.name.startswith("."):
            continue
        if p.suffix.lower() not in DROP_EXTS:
            continue
        st = p.stat()
        items.append({
            "name": p.name,
            "size": st.st_size,
            "mtime": st.st_mtime,
        })
    items.sort(key=lambda x: -x["mtime"])
    return items


@app.route("/drop/list")
def drop_list():
    return jsonify({
        "folder": str(WATCH_DIR),
        "items": _drop_list(),
    })


@app.route("/drop/file")
def drop_file():
    name = request.args.get("name", "")
    if "/" in name or name.startswith("."):
        return jsonify({"error": "invalid name"}), 400
    path = WATCH_DIR / name
    if not path.is_file():
        return jsonify({"error": "not found"}), 404
    return send_file(str(path), mimetype="application/octet-stream")


@app.route("/drop/consume", methods=["POST"])
def drop_consume():
    body = request.get_json(force=True, silent=True) or {}
    name = str(body.get("name", ""))
    if "/" in name or name.startswith("."):
        return jsonify({"error": "invalid name"}), 400
    path = WATCH_DIR / name
    if not path.is_file():
        return jsonify({"error": "not found"}), 404
    dst = CONSUMED_DIR / f"{int(time.time())}_{path.name}"
    path.rename(dst)
    log(f"drop consumed: {name}")
    return jsonify({"ok": True})


# ---- Sketches uploaded from the Manta (lasso -> Mac) ----

@app.route("/sketch", methods=["POST"])
def sketch():
    raw = request.get_data(cache=False)
    if not raw:
        return jsonify({"error": "no body"}), 400
    name = request.args.get("name", "")
    if not name:
        name = f"manta_{time.strftime('%Y%m%d_%H%M%S')}.png"
    if "/" in name or name.startswith("."):
        return jsonify({"error": "invalid name"}), 400

    # If the plugin sent crop coordinates (the lasso rect, in note pixel
    # coordinates that match the rendered page), crop to just that area.
    # Otherwise save the whole page as-is.
    try:
        cl = int(request.args.get("cropL", "")) if request.args.get("cropL") else None
        ct = int(request.args.get("cropT", "")) if request.args.get("cropT") else None
        cr = int(request.args.get("cropR", "")) if request.args.get("cropR") else None
        cb = int(request.args.get("cropB", "")) if request.args.get("cropB") else None
    except ValueError:
        cl = ct = cr = cb = None

    # Optional output format. The Manta always uploads PNG bytes; if the
    # user picked JPEG in Settings, we re-encode here.
    fmt_q = (request.args.get("format", "") or "").lower().strip()
    fmt: str
    if fmt_q in ("jpg", "jpeg"):
        fmt = "JPEG"
    elif fmt_q == "png":
        fmt = "PNG"
    elif name.lower().endswith((".jpg", ".jpeg")):
        fmt = "JPEG"
    else:
        fmt = "PNG"

    out_bytes = raw
    needs_reencode = (fmt == "JPEG")

    if cl is not None and ct is not None and cr is not None and cb is not None and cr > cl and cb > ct:
        try:
            img = Image.open(io.BytesIO(raw))
            iw, ih = img.size
            # Clamp to image bounds.
            cl_c = max(0, min(iw, cl))
            ct_c = max(0, min(ih, ct))
            cr_c = max(0, min(iw, cr))
            cb_c = max(0, min(ih, cb))
            if cr_c > cl_c and cb_c > ct_c:
                cropped = img.crop((cl_c, ct_c, cr_c, cb_c))
                buf = io.BytesIO()
                if fmt == "JPEG":
                    cropped.convert("RGB").save(buf, format="JPEG", quality=92, optimize=True)
                else:
                    cropped.save(buf, format="PNG", optimize=False)
                out_bytes = buf.getvalue()
                needs_reencode = False
                log(f"sketch cropped {iw}x{ih} -> {cr_c - cl_c}x{cb_c - ct_c} ({fmt})")
        except Exception as e:  # noqa: BLE001
            log(f"sketch crop failed (saving full page): {e}")

    if needs_reencode:
        try:
            img = Image.open(io.BytesIO(raw))
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="JPEG", quality=92, optimize=True)
            out_bytes = buf.getvalue()
        except Exception as e:  # noqa: BLE001
            log(f"sketch JPEG encode failed (saving as PNG): {e}")

    # Make sure the filename extension matches the actual format.
    if fmt == "JPEG" and not name.lower().endswith((".jpg", ".jpeg")):
        name = name.rsplit(".", 1)[0] + ".jpg"
    elif fmt == "PNG" and not name.lower().endswith(".png"):
        name = name.rsplit(".", 1)[0] + ".png"

    path = SKETCHES_DIR / name
    path.write_bytes(out_bytes)
    log(f"sketch saved: {path} ({len(out_bytes)} bytes, {fmt})")
    return jsonify({"ok": True, "path": str(path), "name": name, "format": fmt})


# ---- Adjustment presets ----

def _read_presets() -> list:
    if not PRESETS_PATH.exists():
        return []
    try:
        data = json.loads(PRESETS_PATH.read_text())
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _write_presets(items: list) -> None:
    PRESETS_PATH.write_text(json.dumps(items, indent=2))


@app.route("/presets")
def get_presets():
    return jsonify(_read_presets())


@app.route("/presets", methods=["POST"])
def save_preset():
    body = request.get_json(force=True, silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    preset = {
        "name": name,
        "fade": int(body.get("fade", 0)),
        "brightness": int(body.get("brightness", 0)),
        "contrast": int(body.get("contrast", 0)),
        "gamma": float(body.get("gamma", 1.0)),
        "dither": str(body.get("dither", "none")),
    }
    items = [p for p in _read_presets() if p.get("name") != name]
    items.append(preset)
    _write_presets(items)
    log(f"preset saved: {name}")
    return jsonify({"ok": True, "preset": preset, "presets": items})


@app.route("/presets/<name>", methods=["DELETE"])
def delete_preset(name):
    items = [p for p in _read_presets() if p.get("name") != name]
    _write_presets(items)
    log(f"preset deleted: {name}")
    return jsonify({"ok": True, "presets": items})


def run_server(host: str, port: int) -> None:
    from werkzeug.serving import make_server

    log(f"server listening on http://{host}:{port}")
    server = make_server(host, port, app, threaded=True)
    server.serve_forever()


def start_background(port: int) -> None:
    threading.Thread(target=capture_loop, daemon=True).start()
    threading.Thread(target=run_server, args=("0.0.0.0", port), daemon=True).start()
