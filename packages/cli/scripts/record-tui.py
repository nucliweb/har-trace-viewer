"""Records the terminal report as the animated GIFs of the README: docs/tui-tour.gif and
docs/tui-compare.gif.

Drives the built CLI (packages/cli/dist) in a pseudo-terminal with a fixed list of keys, over the
recordings in fixtures/, and renders each session with agg (https://github.com/asciinema/agg).

Usage, from the repository root after `npm run build`:
    python3 packages/cli/scripts/record-tui.py [tour|compare ...]
"""

import codecs
import fcntl
import json
import os
import select
import shutil
import struct
import subprocess
import sys
import tempfile
import termios
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ENTRY = os.path.join(ROOT, "packages", "cli", "dist", "index.js")
COLS, ROWS = 110, 30

# Short names for the fixtures, as a session would type them.
FILES = {
    "cold.har": "webperf-snippets.nucliweb.net_Disable-Cache-20260519T123602.har",
    "cold-trace.json.gz": "WebPerf-Snippets-Disable-Cache_Trace-20260519T123602.json.gz",
    "warm.har": "webperf-snippets.nucliweb.net_Cache-20260519T123746.har",
}

ESC = "\x1b"
RIGHT, DOWN = ESC + "[C", ESC + "[B"

# Each key: (seconds to wait before it, the key, seconds between its characters when typed).
# Keys are written whole: an escape sequence sent one character at a time reads as Esc, which quits.
SCENES = {
    "tour": {
        "args": ["cold.har", "cold-trace.json.gz"],
        "keys": [
            (3.5, DOWN, 0),  # Findings
            (0.3, DOWN, 0),
            (0.3, DOWN, 0),
            (0.3, DOWN, 0),
            (1.5, "2", 0),  # Waterfall: the third parties, then the axis on the page load
            (3.0, "/", 0),
            (0.6, "-party:first", 0.09),
            (0.8, "\r", 0),
            (2.5, ESC, 0),
            (1.0, "z", 0),
            (2.5, "z", 0),
            (1.0, "3", 0),  # Resources, sorted by size, then by time
            (2.0, "s", 0),
            (1.2, "s", 0),
            (2.0, "4", 0),  # Overview
            (3.5, "5", 0),  # Steps
            (2.0, RIGHT, 0),
            (1.5, RIGHT, 0),
            (1.5, RIGHT, 0),
            (2.0, "6", 0),  # Hosts
            (3.0, "7", 0),  # Cache & network
            (3.0, "?", 0),  # the keys and the filter syntax
            (3.5, "x", 0),
            (1.0, "q", 0),
        ],
    },
    "compare": {
        "args": ["--page", "cold", "cold.har", "--compare-with", "warm.har"],
        "keys": [
            (3.5, "2", 0),  # Waterfall of A, then of B
            (3.0, "b", 0),
            (3.0, "7", 0),  # Cache & network of B, then of A
            (3.0, "a", 0),
            (3.0, "6", 0),  # Hosts, A and B side by side
            (3.5, "q", 0),
        ],
    },
}


def record(scene, workdir, cast_path):
    plan = SCENES[scene]
    master, slave = os.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    env = {**os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor", "FORCE_COLOR": "3"}
    proc = subprocess.Popen(
        ["node", ENTRY, *plan["args"]],
        cwd=workdir,
        stdin=slave,
        stdout=slave,
        stderr=slave,
        env=env,
        start_new_session=True,
    )
    os.close(slave)

    # The command typed at a prompt, before the report opens.
    command = "htv " + " ".join(plan["args"])
    events = [[0.0, "o", "\x1b[1;36m$\x1b[0m "]]
    events += [[0.4 + i * 0.045, "o", ch] for i, ch in enumerate(command)]
    offset = 0.4 + len(command) * 0.045 + 0.4
    events.append([offset, "o", "\r\n"])

    # A UTF-8 character can arrive split across two reads: decode the stream, not each read.
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    start = time.monotonic()

    def drain(seconds):
        until = time.monotonic() + seconds
        while (left := until - time.monotonic()) > 0:
            ready, _, _ = select.select([master], [], [], left)
            if not ready:
                return
            try:
                data = os.read(master, 65536)
            except OSError:
                return
            if not data:
                return
            text = decoder.decode(data)
            if text:
                events.append([offset + time.monotonic() - start, "o", text])

    for wait, keys, gap in plan["keys"]:
        drain(wait)
        if gap:
            for ch in keys:
                os.write(master, ch.encode())
                drain(gap)
        else:
            os.write(master, keys.encode())
    drain(1.0)
    proc.wait(timeout=5)
    if proc.returncode != 0:
        sys.exit(f"{scene}: htv exited with {proc.returncode}")

    with open(cast_path, "w") as f:
        f.write(json.dumps({"version": 2, "width": COLS, "height": ROWS}) + "\n")
        for t, kind, text in events:
            f.write(json.dumps([round(t, 4), kind, text]) + "\n")


def main():
    if not os.path.exists(ENTRY):
        sys.exit("Build the CLI first: npm run build")
    if not shutil.which("agg"):
        sys.exit("agg renders the GIFs: https://github.com/asciinema/agg (brew install agg)")
    scenes = sys.argv[1:] or list(SCENES)
    with tempfile.TemporaryDirectory() as workdir:
        for name, fixture in FILES.items():
            os.symlink(os.path.join(ROOT, "fixtures", fixture), os.path.join(workdir, name))
        for scene in scenes:
            cast = os.path.join(workdir, f"{scene}.cast")
            gif = os.path.join(ROOT, "docs", f"tui-{scene}.gif")
            record(scene, workdir, cast)
            subprocess.run(
                ["agg", "--font-size", "14", "--theme", "monokai", "--quiet", cast, gif],
                check=True,
            )
            print(f"{os.path.relpath(gif, ROOT)}: {os.path.getsize(gif) // 1024} KB")


if __name__ == "__main__":
    main()
