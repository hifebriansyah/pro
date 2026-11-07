#!/usr/bin/env python3
"""Upload the pro Worker to Cloudflare. No Node, no wrangler, stdlib only.

    python3 tools/deploy_worker.py             upload it
    python3 tools/deploy_worker.py --dry-run   build the upload and print what would be sent; needs no tokens, sends nothing

Reads worker/pro.jsonc and worker/pro.js, follows its imports into src/ (the same files bin/proxy.js uses, so the Worker and the
local proxy cannot drift apart), puts the skills from skills/*/SKILL.md into the code, uploads everything as modules, attaches
pro-worker.situs.id and turns the workers.dev address off. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, from .env here,
../.env or ../chat-learning/.env (the values are never printed). AXIOM_TOKEN (the request log) is copied to the Worker from the same
files. BRAVE_API_KEY (better search, optional) is entered in the Cloudflare dashboard; deploys keep it.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = os.environ.get("CLOUDFLARE_API_BASE", "https://api.cloudflare.com/client/v4")
IMPORT = re.compile(r'''from\s+["'](\.{1,2}/[^"']+)["']''')


def load_env():
    for f in (ROOT / ".env", ROOT.parent / ".env", ROOT.parent / "chat-learning" / ".env"):  # the first file that has a value wins
        if f.exists():
            for line in f.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


def read_config():
    # the .jsonc file only has whole-line // comments, so this is enough.
    text = (ROOT / "worker" / "pro.jsonc").read_text(encoding="utf-8")
    return json.loads("\n".join(l for l in text.splitlines() if not l.strip().startswith("//")))


def skills():
    """skills/<name>/SKILL.md -> {name, description, triggers, body}: the same reading as parseSkill in src/skills.js."""
    out = []
    for f in sorted((ROOT / "skills").glob("*/SKILL.md")):
        m = re.match(r"---\r?\n(.*?)\r?\n---\r?\n?(.*)$", f.read_text(encoding="utf-8"), re.S)
        if not m:
            sys.exit(f"{f.parent.name}/SKILL.md: it must start with a --- frontmatter block")
        field = lambda k: (re.search(rf"^{k}:\s*(.+)$", m[1], re.M) or [None, ""])[1].strip()
        if not field("name"):
            sys.exit(f"{f.parent.name}/SKILL.md: the frontmatter needs a name:")
        out.append({"name": field("name"), "description": field("description"),
                    "triggers": [t.strip().lower() for t in field("triggers").split(",") if t.strip()], "body": m[2].strip()})
    return out


def modules(main):
    """The main file and every file it imports (and they import), as {flat name: code}. The Worker upload has no folders, so
    "../src/serve.js" in the main file becomes "./serve.js" and the files are sent side by side."""
    main_path = ROOT / "worker" / main
    found, todo = {}, [main_path]
    while todo:
        path = todo.pop()
        if path.name in found:
            if found[path.name][0] != path:
                sys.exit(f"two modules are called {path.name}: {found[path.name][0]} and {path}")
            continue
        code = path.read_text(encoding="utf-8")
        for rel in IMPORT.findall(code):
            todo.append((path.parent / rel).resolve())
        found[path.name] = (path, code)
    out = {}
    for name, (path, code) in found.items():
        out[name] = IMPORT.sub(lambda m: f'from "./{Path(m[1]).name}"', code)
    return out


def call(token, method, path, body=None):
    req = urllib.request.Request(
        f"{BASE}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "pro-deploy/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read())
        except Exception:
            return {"success": False, "errors": [{"message": f"HTTP {e.code}"}]}


def main():
    dry = "--dry-run" in sys.argv[1:]
    load_env()
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not dry and (not token or not account):
        sys.exit("Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env")
    cfg = read_config()
    found_skills = skills()
    mods = modules(cfg["main"])
    if "__SKILLS__" not in mods[cfg["main"]]:
        sys.exit("worker code has no __SKILLS__ placeholder")
    mods[cfg["main"]] = mods[cfg["main"]].replace("__SKILLS__", json.dumps(found_skills, ensure_ascii=False), 1)

    bindings = [{"type": "ratelimit", "name": r["name"], "namespace_id": r["namespace_id"], "simple": r["simple"]} for r in cfg.get("ratelimits", [])]
    bindings += [{"type": "r2_bucket", "name": r["binding"], "bucket_name": r["bucket_name"]} for r in cfg.get("r2_buckets", [])]
    if cfg.get("ai"):
        bindings.append({"type": "ai", "name": cfg["ai"]["binding"]})
    bindings += [{"type": "plain_text", "name": k, "text": v} for k, v in cfg.get("vars", {}).items()]
    metadata = {"main_module": cfg["main"], "compatibility_date": cfg["compatibility_date"], "bindings": bindings,
                "keep_bindings": ["secret_text"]}  # BRAVE_API_KEY stays across deploys
    if cfg.get("placement"):
        metadata["placement"] = cfg["placement"]

    if dry:
        print(f"Would upload worker '{cfg['name']}' to https://{cfg['domain']}/")
        for name, code in mods.items():
            print(f"  module {name}{' (main)' if name == cfg['main'] else ''}: {len(code.encode('utf-8'))} bytes")
        print(f"  skills: {', '.join(s['name'] for s in found_skills) or 'none'}")
        print(f"  bindings: {', '.join(b['name'] for b in bindings)}")
        return

    boundary = uuid.uuid4().hex
    body = b""
    parts = [("metadata", None, "application/json", json.dumps(metadata))]
    parts += [(name, name, "application/javascript+module", code) for name, code in mods.items()]
    for name, filename, ctype, content in parts:
        disp = f'form-data; name="{name}"' + (f'; filename="{filename}"' if filename else "")
        body += f"--{boundary}\r\nContent-Disposition: {disp}\r\nContent-Type: {ctype}\r\n\r\n{content}\r\n".encode("utf-8")
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{BASE}/accounts/{account}/workers/scripts/{cfg['name']}", data=body, method="PUT", headers={
        "Authorization": f"Bearer {token}", "Content-Type": f"multipart/form-data; boundary={boundary}",
        "User-Agent": "pro-deploy/1.0",  # Cloudflare blocks the default Python user agent
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            payload = json.loads(res.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"Deploy failed: HTTP {e.code}\n{e.read().decode('utf-8', 'replace')[:500]}")
    if not payload.get("success"):
        sys.exit(f"Deploy failed: {payload.get('errors')}")
    print(f"Deployed worker '{cfg['name']}' (modules: {', '.join(mods)}; skills: {', '.join(s['name'] for s in found_skills) or 'none'}).")
    for name in ("AXIOM_TOKEN", "BACKEND_SECRET"):  # copied from .env, never printed
        value = os.environ.get(name)
        if value:
            res = call(token, "PUT", f"/accounts/{account}/workers/scripts/{cfg['name']}/secrets", {"name": name, "text": value, "type": "secret_text"})
            print(f"Secret {name} {'set' if res.get('success') else 'NOT set'} on the Worker.")

    domain = cfg["domain"]
    zones = call(token, "GET", f"/zones?name={'.'.join(domain.split('.')[-2:])}").get("result") or []
    if zones:
        res = call(token, "PUT", f"/accounts/{account}/workers/domains",
                   {"hostname": domain, "service": cfg["name"], "environment": "production", "zone_id": zones[0]["id"]})
        print(f"Domain https://{domain}/ -> {cfg['name']}" if res.get("success") else f"Domain {domain} NOT attached: {res.get('errors')}")
    else:
        print(f"Domain {domain}: the token cannot read its zone; attach it in the dashboard.")
    off = call(token, "POST", f"/accounts/{account}/workers/scripts/{cfg['name']}/subdomain", {"enabled": False})
    print("workers.dev address off" if off.get("success") else f"workers.dev not changed ({(off.get('errors') or [{}])[0].get('message')})")
    print("BRAVE_API_KEY (optional, better search) is a secret you enter in the dashboard (Worker > Settings > Variables and Secrets); deploys keep it.")


if __name__ == "__main__":
    main()
