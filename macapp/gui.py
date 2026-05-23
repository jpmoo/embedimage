"""Tkinter UI for the capture server.

Lives in the main thread; the Flask + capture threads from `server.py` run
in the background. The UI lets you pick a source (full screen, region, or
a specific window), start/stop capture, change the interval, see the LAN
IP/port the plugin should target, and watch a rolling log.
"""
from __future__ import annotations

import time
import tkinter as tk
from tkinter import ttk

import mss
from PIL import Image, ImageTk

from . import server


# ---- Region picker (embedded thumbnail) ----

REGION_PREVIEW_MAX = 640


class RegionPicker:
    """Modal window showing a downscaled screenshot; drag to select region.

    The user's screen is captured once and rendered into the dialog at
    around 640px wide. Drag coordinates on the canvas are mapped back to
    monitor pixels so the live capture loop crops the right area.
    """

    def __init__(self, parent, on_done):
        self.on_done = on_done

        with mss.mss() as sct:
            monitors = sct.monitors
            mon = monitors[1] if len(monitors) > 1 else monitors[0]
            shot = sct.grab(mon)
            pil_full = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")

        self.mon_x = int(mon["left"])
        self.mon_y = int(mon["top"])
        self.mon_w = int(mon["width"])
        self.mon_h = int(mon["height"])

        scale = REGION_PREVIEW_MAX / max(self.mon_w, self.mon_h)
        self.scale = scale
        thumb_w = max(1, int(self.mon_w * scale))
        thumb_h = max(1, int(self.mon_h * scale))
        pil_thumb = pil_full.resize((thumb_w, thumb_h), Image.LANCZOS)

        self.root = tk.Toplevel(parent)
        self.root.title("Select region")
        self.root.transient(parent)
        self.root.grab_set()
        self.root.resizable(False, False)

        self.hint = ttk.Label(
            self.root,
            text="Drag on the preview to pick a region. Esc to cancel.",
            foreground="#444",
        )
        self.hint.pack(padx=8, pady=(8, 4))

        self._photo = ImageTk.PhotoImage(pil_thumb)
        self.canvas = tk.Canvas(
            self.root, width=thumb_w, height=thumb_h, highlightthickness=1,
            highlightbackground="#888", cursor="crosshair",
        )
        self.canvas.create_image(0, 0, image=self._photo, anchor="nw")
        self.canvas.pack(padx=8, pady=4)

        self.size_label = ttk.Label(self.root, text="(no selection)", foreground="#666")
        self.size_label.pack(padx=8, pady=4)

        btn_row = ttk.Frame(self.root)
        btn_row.pack(padx=8, pady=(0, 8), fill="x")
        ttk.Button(btn_row, text="Cancel", command=self._cancel).pack(side="right", padx=4)
        self.ok_btn = ttk.Button(btn_row, text="Use selection", command=self._confirm, state="disabled")
        self.ok_btn.pack(side="right", padx=4)
        ttk.Button(btn_row, text="Full screen", command=self._use_full).pack(side="left", padx=4)

        self.start = None
        self.rect_id = None
        self.selection = None  # (cx0, cy0, cx1, cy1) in canvas pixels

        self.canvas.bind("<Button-1>", self._on_down)
        self.canvas.bind("<B1-Motion>", self._on_move)
        self.canvas.bind("<ButtonRelease-1>", self._on_up)
        self.root.bind("<Escape>", lambda _: self._cancel())
        self.root.bind("<Return>", lambda _: self._confirm() if self.selection else None)
        self.root.protocol("WM_DELETE_WINDOW", self._cancel)

    def _on_down(self, e):
        self.start = (e.x, e.y)
        if self.rect_id:
            self.canvas.delete(self.rect_id)
        self.rect_id = self.canvas.create_rectangle(
            e.x, e.y, e.x, e.y, outline="#ff3", width=2,
        )

    def _on_move(self, e):
        if self.start is None or self.rect_id is None:
            return
        self.canvas.coords(self.rect_id, self.start[0], self.start[1], e.x, e.y)
        self._update_size_label(self.start[0], self.start[1], e.x, e.y)

    def _on_up(self, e):
        if self.start is None:
            return
        x0, y0 = self.start
        x1, y1 = e.x, e.y
        cw = abs(x1 - x0)
        ch = abs(y1 - y0)
        if cw < 4 or ch < 4:
            if self.rect_id:
                self.canvas.delete(self.rect_id)
                self.rect_id = None
            self.selection = None
            self.size_label.config(text="(too small — drag a bigger box)")
            self.ok_btn.config(state="disabled")
            return
        self.selection = (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
        self._update_size_label(x0, y0, x1, y1)
        self.ok_btn.config(state="normal")

    def _update_size_label(self, x0, y0, x1, y1):
        cw = abs(x1 - x0)
        ch = abs(y1 - y0)
        sw = round(cw / self.scale)
        sh = round(ch / self.scale)
        self.size_label.config(text=f"selection: {sw}×{sh} px (preview {cw}×{ch})")

    def _to_monitor(self):
        if not self.selection:
            return None
        cx0, cy0, cx1, cy1 = self.selection
        return {
            "x": self.mon_x + round(cx0 / self.scale),
            "y": self.mon_y + round(cy0 / self.scale),
            "w": round((cx1 - cx0) / self.scale),
            "h": round((cy1 - cy0) / self.scale),
        }

    def _confirm(self):
        region = self._to_monitor()
        self.root.destroy()
        self.on_done(region)

    def _use_full(self):
        self.root.destroy()
        self.on_done({"x": self.mon_x, "y": self.mon_y, "w": self.mon_w, "h": self.mon_h})

    def _cancel(self):
        self.root.destroy()
        self.on_done(None)


# ---- Main window ----

class App:
    def __init__(self, port: int):
        self.port = port
        self.root = tk.Tk()
        self.root.title("Supernote Capture Server")
        self.root.geometry("520x520")

        self._build_ui()
        self._refresh_windows()
        self._poll_status()

    def _build_ui(self):
        pad = {"padx": 8, "pady": 4}

        # Connection info
        info_frame = ttk.LabelFrame(self.root, text="Connection")
        info_frame.pack(fill="x", **pad)
        self.ip_var = tk.StringVar(value=server.get_local_ip())
        self.port_var = tk.StringVar(value=str(self.port))
        ttk.Label(info_frame, text="LAN IP:").grid(row=0, column=0, sticky="w", padx=4, pady=4)
        ttk.Label(info_frame, textvariable=self.ip_var, font=("Menlo", 12, "bold")).grid(
            row=0, column=1, sticky="w", padx=4
        )
        ttk.Label(info_frame, text="Port:").grid(row=0, column=2, sticky="e", padx=4)
        port_entry = ttk.Entry(info_frame, textvariable=self.port_var, width=8)
        port_entry.grid(row=0, column=3, padx=4)
        ttk.Button(info_frame, text="Apply", command=self._apply_port).grid(row=0, column=4, padx=4)
        ttk.Label(
            info_frame,
            text="In the Manta plugin: Settings → Mac Capture Server.",
            foreground="#555",
        ).grid(row=1, column=0, columnspan=5, sticky="w", padx=4, pady=(0, 4))

        # Source picker
        src_frame = ttk.LabelFrame(self.root, text="Source")
        src_frame.pack(fill="x", **pad)
        self.source_var = tk.StringVar(value="screen")
        ttk.Radiobutton(
            src_frame, text="Full screen", variable=self.source_var, value="screen",
            command=self._send_source,
        ).grid(row=0, column=0, sticky="w", padx=4, pady=2)
        ttk.Radiobutton(
            src_frame, text="Region (drag to pick)", variable=self.source_var, value="region",
            command=self._send_source,
        ).grid(row=1, column=0, sticky="w", padx=4, pady=2)
        ttk.Button(src_frame, text="Pick region…", command=self._pick_region).grid(
            row=1, column=1, padx=4
        )
        self.region_label = ttk.Label(src_frame, text="(none)", foreground="#666")
        self.region_label.grid(row=1, column=2, sticky="w", padx=4)
        ttk.Radiobutton(
            src_frame, text="Window:", variable=self.source_var, value="window",
            command=self._send_source,
        ).grid(row=2, column=0, sticky="w", padx=4, pady=2)
        self.window_combo = ttk.Combobox(src_frame, state="readonly", width=48)
        self.window_combo.grid(row=2, column=1, columnspan=2, sticky="w", padx=4)
        self.window_combo.bind("<<ComboboxSelected>>", lambda _: self._send_source())
        ttk.Button(src_frame, text="Refresh", command=self._refresh_windows).grid(
            row=2, column=3, padx=4
        )

        # Interval
        int_frame = ttk.LabelFrame(self.root, text="Interval")
        int_frame.pack(fill="x", **pad)
        self.interval_var = tk.DoubleVar(value=1.0)
        ttk.Scale(
            int_frame, from_=0.2, to=10.0, orient="horizontal", variable=self.interval_var,
            command=lambda _: self._send_interval(),
        ).pack(fill="x", padx=4, pady=4)
        self.interval_label = ttk.Label(int_frame, text="1.0 s / frame")
        self.interval_label.pack(padx=4, pady=(0, 4))

        # Start/Stop + status
        ctl_frame = ttk.Frame(self.root)
        ctl_frame.pack(fill="x", **pad)
        self.toggle_btn = ttk.Button(ctl_frame, text="Start", command=self._toggle)
        self.toggle_btn.pack(side="left", padx=4)
        self.status_label = ttk.Label(ctl_frame, text="stopped", foreground="#a00")
        self.status_label.pack(side="left", padx=12)
        self.frame_label = ttk.Label(ctl_frame, text="0 frames")
        self.frame_label.pack(side="right", padx=4)

        # Log
        log_frame = ttk.LabelFrame(self.root, text="Log")
        log_frame.pack(fill="both", expand=True, **pad)
        self.log_box = tk.Text(log_frame, height=10, wrap="word", state="disabled")
        self.log_box.pack(fill="both", expand=True, padx=4, pady=4)

    # --- event handlers ---

    def _apply_port(self):
        try:
            self.port = int(self.port_var.get())
        except ValueError:
            return
        self._log("Port change requires restart of the app.")

    def _refresh_windows(self):
        wins = server.list_windows()
        items = [
            f"#{w['id']}  [{w['owner']}]  {w['title'][:40] or '(untitled)'}  {w['w']}×{w['h']}"
            for w in wins
        ]
        self._windows = wins
        self.window_combo["values"] = items
        if items and not self.window_combo.get():
            self.window_combo.current(0)

    def _pick_region(self):
        def done(region):
            if region:
                self.region_label.config(
                    text=f"{region['w']}×{region['h']} @ {region['x']},{region['y']}"
                )
                self._region = region
                self.source_var.set("region")
                self._send_source()
            else:
                self._log("region pick cancelled")

        RegionPicker(self.root, done)

    def _send_source(self):
        src = self.source_var.get()
        if src == "screen":
            server.STATE.source = "screen"
            server.STATE.monitor_index = 1
        elif src == "region":
            r = getattr(self, "_region", None)
            if r:
                server.STATE.region = r
            server.STATE.source = "region"
        elif src == "window":
            idx = self.window_combo.current()
            if idx >= 0 and idx < len(self._windows):
                server.STATE.window_id = self._windows[idx]["id"]
            server.STATE.source = "window"
        self._log(f"source -> {src}")

    def _send_interval(self):
        v = round(float(self.interval_var.get()), 2)
        server.STATE.interval_sec = v
        self.interval_label.config(text=f"{v:.2f} s / frame")

    def _toggle(self):
        server.STATE.running = not server.STATE.running
        self._log("start" if server.STATE.running else "stop")

    def _log(self, msg: str):
        ts = time.strftime("%H:%M:%S")
        self.log_box.configure(state="normal")
        self.log_box.insert("end", f"{ts}  {msg}\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def _poll_status(self):
        running = server.STATE.running
        self.toggle_btn.configure(text="Stop" if running else "Start")
        self.status_label.configure(
            text="running" if running else "stopped",
            foreground="#080" if running else "#a00",
        )
        self.frame_label.configure(text=f"{server.STATE.frame_count} frames")

        # Mirror server-side log into the GUI.
        srv_log = list(server.STATE.log)
        if hasattr(self, "_log_cursor"):
            new = srv_log[self._log_cursor:]
        else:
            new = srv_log
        for entry in new:
            self._log(f"[srv] {entry['msg']}")
        self._log_cursor = len(srv_log)

        self.root.after(500, self._poll_status)

    def run(self):
        self.root.mainloop()


def main(port: int):
    server.start_background(port)
    App(port=port).run()
