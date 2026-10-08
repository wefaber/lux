import { useEffect, type RefObject } from "react";

// Una tabla que no entra a lo ancho se muestra como tarjetas (una por fila, cada
// dato con su titulo al lado) en vez de obligar a desplazarla de costado. Se
// decide midiendo y no con un ancho fijo: asi funciona con cualquier tamaño de
// letra, de pantalla y cantidad de columnas. Los estilos estan en index.css
// (table[data-cards]).
export function useResponsiveTables(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = root.current;
    if (!el) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      for (const table of el.querySelectorAll("table")) {
        labelCells(table);
        fitOrCards(table);
      }
    };
    // Varios cambios seguidos se resuelven en una sola medicion por cuadro
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    // Filas nuevas, datos que cambian, pantallas que se montan
    const content = new MutationObserver(schedule);
    content.observe(el, { childList: true, subtree: true, characterData: true });
    // El tamaño de letra y la fuente se cambian con atributos de <html>
    const prefs = new MutationObserver(schedule);
    prefs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-font-size", "data-dyslexic", "class"],
    });
    // Ventana, menu lateral que se colapsa, rotacion del telefono
    const size = new ResizeObserver(schedule);
    size.observe(el);

    schedule();
    return () => {
      content.disconnect();
      prefs.disconnect();
      size.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root]);
}

// Cada celda lleva el titulo de su columna, para mostrarlo en modo tarjeta.
// Se escriben atributos, que el MutationObserver de contenido no observa: no
// hay bucle.
function labelCells(table: HTMLTableElement): void {
  const headers = Array.from(table.tHead?.rows[0]?.cells ?? [], (th) => th.textContent?.trim() ?? "");
  for (const body of table.tBodies) {
    for (const row of body.rows) {
      Array.from(row.cells).forEach((cell, i) => {
        const label = headers[i];
        if (label && cell.dataset.label !== label) cell.dataset.label = label;
        else if (!label && cell.dataset.label) delete cell.dataset.label;
      });
    }
  }
}

// Se mide siempre en modo tabla: sacar y volver a poner el atributo pasa dentro
// del mismo cuadro, antes de pintar, asi que no se ve ningun parpadeo
function fitOrCards(table: HTMLTableElement): void {
  const box = table.parentElement;
  if (!box) return;
  delete table.dataset.cards;
  if (table.offsetWidth > box.clientWidth + 1) table.dataset.cards = "true";
}
