#!/usr/bin/env python3
"""Cache busting for the page's JavaScript modules: put ?v=<hash> on every relative module import in a built copy of the site.

    python3 tools/stamp_modules.py _site      the Pages workflow runs this on every deploy (it never stamps the repo itself:
                                              the node tests and the backend import the modules by their plain names)

Cloudflare keeps the .js files in the browser for hours, while index.html is fetched fresh, so a visitor could run a new page with
old modules. Every import ("./core.js", import("./office/office.js"), "../src/roster.js") gets ?v=<first 8 hex of the SHA-1 of the
imported file>. The hash is taken after the file's own imports are stamped, so a change in a deep module changes the address of every
module above it, up to index.html: exactly the chain a browser has to fetch again. The same file always gets the same address, so a
module is still loaded once. Running it twice gives the same result. Standard library only; an import cycle or a missing file stops
it with an error.
"""
import hashlib
import re
import sys
from pathlib import Path

# from "./x.js"   import "./x.js"   import("./x.js"): a relative address ending in .js, with or without an old ?v=
IMPORT = re.compile(r"""(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}/[^"'?#\s]+\.js)(\?v=[0-9a-f]+)?\2""")


def stamp(root: Path) -> int:
    root = root.resolve()
    done: dict[Path, tuple[str, str]] = {}  # file -> (stamped text, hash)
    busy: list[Path] = []

    def build(file: Path) -> tuple[str, str]:
        if file in done:
            return done[file]
        if file in busy:
            raise SystemExit("import cycle: " + " -> ".join(p.relative_to(root).as_posix() for p in [*busy, file]))
        busy.append(file)

        def versioned(m: re.Match) -> str:
            target = (file.parent / m[3]).resolve()
            if root not in target.parents or not target.is_file():
                raise SystemExit(f"{file.relative_to(root)}: imports {m[3]}, which is not in the site")
            return f"{m[1]}{m[2]}{m[3]}?v={build(target)[1]}{m[2]}"

        text = IMPORT.sub(versioned, file.read_text(encoding="utf-8"))
        busy.pop()
        done[file] = (text, hashlib.sha1(text.encode("utf-8")).hexdigest()[:8])
        return done[file]

    files = [root / "index.html", *sorted(root.rglob("*.js"))]
    for f in files:
        if f.is_file():
            f.write_text(build(f)[0], encoding="utf-8")
    return len(done)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: stamp_modules.py <built site directory>")
    print(f"module imports stamped in {stamp(Path(sys.argv[1]))} files")
