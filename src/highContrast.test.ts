import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

// Returns the body of the single rule whose selector is exactly `selector`.
const ruleBody = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  if (matches.length !== 1) throw new Error(`expected one rule for ${selector}, found ${matches.length}`);
  return matches[0][1];
};

const declarations = (selector: string): Record<string, string> => {
  const vars: Record<string, string> = {};
  for (const [, name, value] of ruleBody(selector).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[name] = value.trim();
  }
  return vars;
};

const toRgb = (color: string): [number, number, number] => {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/i.exec(color);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`expected a solid hex or rgb() color, got ${color}`);
};

const luminance = (color: string): number => {
  const [r, g, b] = toRgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Effective tokens in high-contrast mode: the base theme (:root, plus .dark in dark mode)
// overridden by the html[data-contrast="high"] block (light) or html.dark[data-contrast="high"] (dark).
const BLOCKS = {
  base: ":root",
  dark: ".dark",
  highLight: 'html[data-contrast="high"]',
  highDark: 'html.dark[data-contrast="high"]',
} as const;
const blocks = Object.fromEntries(Object.entries(BLOCKS).map(([key, sel]) => [key, declarations(sel)]));
const light = { ...blocks.base, ...blocks.highLight };
const dark = { ...blocks.base, ...blocks.dark, ...blocks.highDark };

const TEXT = ["--foreground", "--muted-foreground", "--success", "--warning", "--info", "--destructive"];
const SURFACES = ["--background", "--card", "--muted", "--popover"];
const BORDERS = ["--border", "--input", "--ring"];

describe("high contrast mode", () => {
  test("text reaches 7:1 (AAA) on every main surface", () => {
    for (const tokens of [light, dark]) {
      for (const text of TEXT) {
        for (const surface of SURFACES) {
          expect(contrast(tokens[text], tokens[surface])).toBeGreaterThanOrEqual(7);
        }
      }
    }
  });

  test("borders and focus ring reach 3:1 on every main surface", () => {
    for (const tokens of [light, dark]) {
      for (const border of BORDERS) {
        for (const surface of SURFACES) {
          expect(contrast(tokens[border], tokens[surface])).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  test("every modeled colour token is declared only in the blocks the test reads", () => {
    const parsed = Object.values(blocks);
    for (const name of [...TEXT, ...SURFACES, ...BORDERS]) {
      const declared = css.match(new RegExp(`(?<![\\w-])${name}\\s*:`, "g"))?.length ?? 0;
      const modeled = parsed.filter((block) => name in block).length;
      expect(declared).toBe(modeled);
    }
  });

  test("dark high contrast overrides every token the light block sets", () => {
    // html[data-contrast="high"] also matches in dark mode and beats .dark, so any token
    // left out of html.dark[data-contrast="high"] would leak its light value into dark mode.
    for (const name of Object.keys(blocks.highLight)) {
      expect(name in blocks.highDark, `${name} leaks into dark high contrast`).toBe(true);
    }
  });
});
