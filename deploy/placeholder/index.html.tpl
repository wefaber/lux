<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>dev.eternum.lat — slot {{SLOT}} sin build</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #fbfbfd;
        --card: #ffffff;
        --fg: #1d1d1f;
        --muted: #6e6e73;
        --line: #e5e5ea;
        --accent: #0a6cff;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #101012;
          --card: #17171a;
          --fg: #f5f5f7;
          --muted: #98989d;
          --line: #2c2c30;
          --accent: #4b9bff;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 32px 20px;
        background: var(--bg);
        color: var(--fg);
        font: 400 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      main { width: 100%; max-width: 34rem; }
      .eyebrow {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
        margin: 0 0 10px;
      }
      h1 { font-size: 26px; line-height: 1.2; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 12px; }
      h1 code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 22px; color: var(--accent); }
      p { margin: 0 0 18px; color: var(--muted); }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 20px 22px;
      }
      dl { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; margin: 0; font-size: 14px; }
      dt { color: var(--muted); }
      dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
      .actions { margin-top: 22px; display: flex; flex-wrap: wrap; gap: 10px; }
      a.button {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 9px 15px; border-radius: 10px; text-decoration: none;
        border: 1px solid var(--line); color: var(--fg); font-size: 14px; font-weight: 500;
      }
      a.button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
      footer { margin-top: 26px; font-size: 12px; color: var(--muted); }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">dev.eternum.lat · preview de la rama dev</p>
      <h1>El slot <code>{{SLOT}}</code> todavía no tiene build.</h1>
      <p>
        Acá se publica el SPA de Lux cuando corre el deploy. Este slot está libre:
        el preview que está en línea vive en el otro slot, y este queda listo para
        el próximo deploy o para volver atrás si algo sale mal.
      </p>
      <div class="card">
        <dl>
          <dt>desplegar</dt><dd>~/deploy/lux-dev.sh</dd>
          <dt>estado</dt><dd>~/deploy/lux-dev.sh --status</dd>
          <dt>volver atrás</dt><dd>~/deploy/lux-dev.sh --rollback</dd>
          <dt>API</dt><dd>/graphql del slot en línea</dd>
          <dt>base de datos</dt><dd>/db (TOTP)</dd>
        </dl>
      </div>
      <div class="actions">
        <a class="button primary" href="https://dev.eternum.lat/">Ir al preview en línea</a>
        <a class="button" href="/db/">Panel de la base</a>
      </div>
      <footer>Este slot no forma parte de producción. Las versiones de producción viven en lux.eternum.lat.</footer>
    </main>
  </body>
</html>
