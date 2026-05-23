"""Tkinter UI for the capture server.

Lives in the main thread; the Flask + capture threads from `server.py` run
in the background. The UI lets you pick a source (full screen, region, or
a specific window), start/stop capture, change the interval, see the LAN
IP/port the plugin should target, and watch a rolling log.
"""
from __future__ import annotations

import threading
import time
import tkinter as tk
from tkinter import ttk

from . import server


# ---- Region picker overlay ----

class RegionPicker:
    """A topmost semi-transparent window that lets the user drag a rectangle."""

    def __init__(self, on_done):
        self.on_done = on_done
        self.root = tk.Toplevel()
        self.root.attributes("-fullscreen", True)
        self.root.attributes("-alpha", 0.25)
        self.root.configure(background="#000")
        self.root.attributes("-topmost", True)
        self.canvas = tk.Canvas(self.root, bg="#000", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.start = None
        self.rect_id = None
        self.canvas.bind("<Button-1>", self._on_down)
        self.canvas.bind("<B1-Motion>", self._on_move)
        self.canvas.bind("<ButtonRelease-1>", self._on_up)
        self.root.bind("<Escape>", lambda _: self._cancel())

    def _on_down(self, e):
        self.start = (e.x_root, e.y_root)
        if self.rect_id:
            self.canvas.delete(self.rect_id)
        self.rect_id = self.canvas.create_rectangle(
            e.x, e.y, e.x, e.y, outline="#fff", width=2
        )

    def _on_move(self, e):
        if not self.start or not self.rect_id:
            return
        x0 = self.start[0] - self.root.winfo_rootx()
        y0 = self.start[1] - self.root.winfo_rooty()
        self.canvas.coords(self.rect_id, x0, y0, e.x, e.y)

    def _on_up(self, e):
        if not self.start:
            self._cancel()
            return
        x0, y0 = self.start
        x1, y1 = e.x_root, e.y_root
        x, y = min(x0, x1), min(y0, y1)
        w, h = abs(x1 - x0), abs(y1 - y0)
        self.root.destroy()
        if w < 20 or h < 20:
            self.on_done(None)
        else:
            self.on_done({"x": int(x), "y": int(y), "w": int(w), "h": int(h)})

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
        self.root.iconify()
        time.sleep(0.2)

        def done(region):
            self.root.deiconify()
            if region:
                self.region_label.config(text=f"{region['w']}×{region['h']} @ {region['x']},{region['y']}")
                self._region = region
                self.source_var.set("region")
                self._send_source()
            else:
                self._log("region pick cancelled")

        RegionPicker(done)

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
