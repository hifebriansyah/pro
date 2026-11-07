#!/usr/bin/env python3
"""Deploy the heavy half of /agent (backend/ + src/ + skills/) to Vercel, through its REST API (no npm, no CLI).

The Cloudflare Worker (worker/pro.js) stays the public front and forwards each question to this function with a shared secret.
Needs VERCEL_TOKEN (from .env here, ../.env or ../chat-learning/.env; never printed). The shared secret is made once and kept as BACKEND_SECRET in
.env here (git-ignored): it is set on Vercel as PROXY_SECRET and copied to the Worker by tools/deploy_worker.py. Nothing secret is printed.

  python3 tools/deploy_backend.py            deploy to production
  python3 tools/deploy_backend.py --dry-run  list what would be uploaded
"""
import json, os, secrets, sys, time, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAME = os.environ.get("VERCEL_PROJECT", "pro-api")
TIMEZONE_OFFSET_MINUTES = "420"
DRY = "--dry-run" in sys.argv


def load_env():
    for f in (ROOT / ".env", ROOT.parent / ".env", ROOT.parent / "chat-learning" / ".env"):
        if f.exists():
            for line in f.read_text(encoding="utf-8").splitlines():
                k, sep, v = line.partition("=")
                if sep and not k.strip().startswith("#"):
                    os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


def shared_secret():
    """BACKEND_SECRET from .env here; made and appended the first time."""
    env_file = ROOT / ".env"
    if os.environ.get("BACKEND_SECRET"):
        return os.environ["BACKEND_SECRET"]
    value = secrets.token_urlsafe(32)
    if DRY:
        return value
    with env_file.open("a", encoding="utf-8") as f:
        f.write(("" if not env_file.exists() or env_file.read_text().endswith("\n") else "\n") + f"BACKEND_SECRET={value}\n")
    os.chmod(env_file, 0o600)
    print("Made BACKEND_SECRET in .env (not shown).")
    return value


def collect():
    """What goes to Vercel: backend/* at the top, src/, skills/ and the personas (only the .md files) next to it."""
    files = []
    for base, prefix in ((ROOT / "backend", ""), (ROOT / "src", "src/"), (ROOT / "skills", "skills/"), (ROOT / "personas", "personas/")):
        for f in sorted(base.rglob("*")):
            if f.is_file() and f.name != ".DS_Store" and (prefix != "personas/" or f.suffix == ".md"):
                files.append({"file": prefix + str(f.relative_to(base)), "data": f.read_text(encoding="utf-8")})
    return files


def main():
    files = collect()
    print(f"{len(files)} files, {sum(len(x['data']) for x in files)} bytes: " + ", ".join(x["file"] for x in files))
    if DRY:
        return
    load_env()
    token = os.environ.get("VERCEL_TOKEN") or sys.exit("Set VERCEL_TOKEN in .env")
    secret = shared_secret()
    team = None

    def api(method, path, body=None):
        sep = "&" if "?" in path else "?"
        url = f"https://api.vercel.com{path}" + (f"{sep}teamId={team}" if team else "")
        req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "User-Agent": "pro-deploy/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read())
            except Exception:
                return e.code, {}

    code, user = api("GET", "/v2/user")
    if code != 200:
        sys.exit(f"Vercel refused the token ({code})")
    team = user["user"].get("defaultTeamId") if "user" in user else user.get("defaultTeamId")
    code, p = api("GET", f"/v9/projects/{NAME}")
    if code == 404:
        code, p = api("POST", "/v11/projects", {"name": NAME, "framework": None})
    if code >= 300:
        sys.exit(f"project step failed ({code})")
    for key, value, kind in (("PROXY_SECRET", secret, "sensitive"), ("TIMEZONE_OFFSET_MINUTES", TIMEZONE_OFFSET_MINUTES, "plain")):
        code, e = api("POST", f"/v10/projects/{NAME}/env?upsert=true", {"key": key, "value": value, "type": kind, "target": ["production"]})
        print(f"env {key}: {'set' if code < 300 else 'FAILED ' + str((e.get('error') or {}).get('message'))}")
    code, d = api("POST", "/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1",
                  {"name": NAME, "project": NAME, "target": "production", "files": files, "projectSettings": {"framework": None}})
    if code >= 300:
        sys.exit(f"deployment failed: {d.get('error')}")
    for i in range(60):
        code, s = api("GET", f"/v13/deployments/{d['id']}")
        if s.get("readyState") in ("READY", "ERROR", "CANCELED"):
            break
        time.sleep(5)
    print("state:", s.get("readyState"), "|", s.get("errorMessage") or "")
    print("aliases:", ", ".join(s.get("alias") or []))
    print("Set BACKEND_URL in worker/pro.jsonc to https://<production alias>/agent, then python3 tools/deploy_worker.py")


main()
