"""Entry point: `python -m macapp` starts the GUI + capture server."""
from __future__ import annotations

import argparse

from . import gui


def main():
    parser = argparse.ArgumentParser(description="Supernote screen-capture server (Mac)")
    parser.add_argument("--port", type=int, default=9000, help="HTTP port (default 9000)")
    args = parser.parse_args()
    gui.main(port=args.port)


if __name__ == "__main__":
    main()
