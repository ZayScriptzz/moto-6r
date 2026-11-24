#!/usr/bin/env python3
"""Syntax-check every inline <script> in a single-file HTML app with `node --check`.
Usage: python3 test/check_scripts.py index.html   -> prints one line per script, exits 1 on any failure."""
import os, re, subprocess, sys, tempfile

src = open(sys.argv[1], encoding="utf-8").read()
blocks = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", src, re.S)
bad = 0
with tempfile.TemporaryDirectory() as d:
    for i, js in enumerate(blocks, 1):
        p = os.path.join(d, f"s{i}.js")
        open(p, "w", encoding="utf-8").write(js)
        r = subprocess.run(["node", "--check", p], capture_output=True, text=True)
        ok = r.returncode == 0
        bad += not ok
        print(f"script {i:2d} ({len(js):>7d} chars): {'OK' if ok else 'FAIL'}")
        if not ok:
            print(r.stderr.strip()[:2000])
print(f"{len(blocks)} inline scripts, {bad} failed")
sys.exit(1 if bad else 0)
