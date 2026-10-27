import { afterEach, describe, expect, test } from "bun:test";
import { formatDuration } from "./utils";
import { setLang } from "@/i18n";

afterEach(() => setLang("es"));

describe("duraciones legibles", () => {
  test("minutos, horas y dias con horas", () => {
    expect(formatDuration(0.5)).toBe("30 min");
    expect(formatDuration(2.18)).toBe("2 h");
    expect(formatDuration(47)).toBe("47 h");
    expect(formatDuration(48)).toBe("2 d");
    expect(formatDuration(58.1)).toBe("2 d 10 h");
  });

  test("sigue el idioma activo", () => {
    setLang("en");
    expect(formatDuration(2.18)).toBe("2 hr");
    expect(formatDuration(58.1)).toBe("2 days 10 hr");
  });
});
