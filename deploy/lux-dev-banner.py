#!/usr/bin/env python3
"""Inyecta el disclaimer de preview en el index.html de un build de dev.eternum.lat.

El SPA es un artefacto cerrado: el aviso se agrega al HTML ya buildeado para no
tocar el repo de Lux (que se revisa por PR). El elemento vive fuera de #root y
React no lo toca.

Uso:
  lux-dev-banner.py dist/index.html --branch dev --commit cd02d35 \
      --version 0.1.0 --release v0.1.0 --slot green --mode mocks \
      --built "2026-10-12 05:12 UTC"
"""
from __future__ import annotations

import argparse
import html
import sys
from pathlib import Path

MARK = "id=\"dev-preview-banner\""

CSS = """
#dev-preview-banner { position: fixed; right: 12px; bottom: 88px; z-index: 60;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  max-width: min(92vw, 30rem); }
@media (min-width: 768px) { #dev-preview-banner { bottom: 14px; } }
#dev-preview-banner * { box-sizing: border-box; }
#dev-preview-banner button.dev-pill { display: flex; align-items: center; gap: 8px;
  margin-left: auto; padding: 7px 11px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--border, #e5e5ea); background: color-mix(in srgb, var(--card, #fff) 88%, transparent);
  backdrop-filter: blur(10px); color: var(--muted-foreground, #6e6e73);
  font: 500 11.5px/1 ui-sans-serif, system-ui, sans-serif; }
#dev-preview-banner button.dev-pill:hover { color: var(--foreground, #1d1d1f); }
#dev-preview-banner .dot { width: 7px; height: 7px; border-radius: 999px; background: #d9822b; flex: none; }
#dev-preview-banner .meta { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
#dev-preview-banner .card { margin-top: 8px; padding: 14px 16px; border-radius: 14px;
  border: 1px solid var(--border, #e5e5ea); background: var(--card, #fff);
  box-shadow: 0 12px 32px rgba(0,0,0,.12); color: var(--foreground, #1d1d1f); font-size: 12.5px; }
#dev-preview-banner .lead { margin: 0 0 10px; color: var(--muted-foreground, #6e6e73); }
#dev-preview-banner dl { display: grid; grid-template-columns: auto 1fr; gap: 5px 12px; margin: 0; }
#dev-preview-banner dt { color: var(--muted-foreground, #6e6e73); }
#dev-preview-banner dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
#dev-preview-banner .links { margin: 12px 0 0; display: flex; gap: 14px; }
#dev-preview-banner a { color: var(--primary, #0a6cff); text-decoration: none; }
#dev-preview-banner a:hover { text-decoration: underline; }
"""

SCRIPT = """
(function () {
  var box = document.getElementById("dev-preview-banner");
  if (!box) return;
  var pill = box.querySelector("button.dev-pill");
  var card = box.querySelector(".card");
  function set(open) {
    card.hidden = !open;
    pill.setAttribute("aria-expanded", open ? "true" : "false");
  }
  pill.addEventListener("click", function () { set(card.hidden); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") set(false); });
  try {
    // Se abre solo la primera vez de cada sesion: que el aviso se vea, sin
    // quedar abierto en cada recarga mientras se prueba.
    if (!sessionStorage.getItem("dev-preview-banner-seen")) {
      sessionStorage.setItem("dev-preview-banner-seen", "1");
      set(true);
      setTimeout(function () { set(false); }, 9000);
    }
  } catch (_) { set(true); }
  set(box.querySelector(".card").hidden);
})();
"""


def build(args: argparse.Namespace) -> str:
    rows = [
        ("rama", args.branch),
        ("commit", args.commit),
        ("release", args.release),
        ("build", args.built),
        ("datos", "reales (Postgres)"),
        ("slot", args.slot),
    ]
    items = "".join(
        f"<dt>{html.escape(k)}</dt><dd>{html.escape(v)}</dd>" for k, v in rows
    )
    return f"""<style>{CSS}</style>
<div id="dev-preview-banner">
  <button class="dev-pill" type="button" aria-expanded="false" aria-controls="dev-preview-card">
    <span class="dot" aria-hidden="true"></span>
    <span>Versión de prueba</span>
    <span class="meta">{html.escape(args.branch)} · {html.escape(args.commit)} · v{html.escape(args.version)}</span>
  </button>
  <div class="card" id="dev-preview-card" hidden>
    <p class="lead">Esto no es producción: es la rama <strong>{html.escape(args.branch)}</strong>
    de Lux desplegada para revisión en dev.eternum.lat.</p>
    <dl>{items}</dl>
    <p class="links">
      <a href="/db/">Panel de la base</a>
      <a href="https://lux.eternum.lat/">Producción</a>
      <a href="https://github.com/wefaber/lux/commit/{html.escape(args.commit)}">Commit</a>
    </p>
  </div>
</div>
<script>{SCRIPT}</script>
"""


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("index", type=Path)
    p.add_argument("--branch", required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--version", required=True)
    p.add_argument("--release", default="")
    p.add_argument("--slot", required=True)
    p.add_argument("--mode", choices=["mocks", "real"], required=True)
    p.add_argument("--built", required=True)
    a = p.parse_args()

    a.release = a.release or f"v{a.version}"

    if not a.index.is_file():
        print(f"ERROR: no existe {a.index}", file=sys.stderr)
        return 1
    doc = a.index.read_text(encoding="utf-8")
    if MARK in doc:
        print("aviso: el index ya tenia el banner, se reemplaza")
        head, _, rest = doc.partition('<div id="dev-preview-banner">')
        tail = rest.partition("</script>")[2]
        doc = head + tail.lstrip()
    if "</body>" in doc:
        doc = doc.replace("</body>", build(a) + "</body>", 1)
    else:
        doc += build(a)
    a.index.write_text(doc, encoding="utf-8")
    print(f"banner inyectado en {a.index} (rama {a.branch}, {a.commit}, {a.mode})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
