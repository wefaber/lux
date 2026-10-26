import { describe, expect, test } from "bun:test";
import {
  countHelpItems,
  filterHelpCategories,
  helpTextFor,
  normalizeHelpSearch,
  parseHelpConfig,
  type HelpConfig,
} from "./help";

// Config minima valida, base de los tests
function validRaw() {
  return {
    contact: {
      email: "soporte@iti.edu.uy",
      schedule: { es: "Lunes a viernes de 9 a 17", en: "Monday to Friday, 9 am to 5 pm" },
      responseTime: "Respondemos en 24 horas habiles",
    },
    guide: { url: "/dashboard", label: { es: "Empezar por el panel", en: "Start at the dashboard" } },
    categories: [
      {
        id: "tickets",
        items: [
          {
            id: "crear-ticket",
            question: { es: "¿Cómo creo un ticket?", en: "How do I create a ticket?" },
            answer: { es: "Andá a Tickets y elegí Nuevo ticket.", en: "Go to Tickets and choose New." },
          },
          {
            question: "¿Puedo reabrir un ticket resuelto?",
            answer: "Sí, desde el detalle del ticket.",
          },
        ],
      },
      {
        id: "loans",
        items: [
          {
            question: { es: "¿Cómo pido un préstamo?", en: "How do I request a loan?" },
            answer: { es: "Desde la sección Préstamos.", en: "From the Loans section." },
          },
        ],
      },
    ],
  };
}

describe("parseHelpConfig", () => {
  test("acepta una configuracion valida y normaliza los textos", () => {
    const result = parseHelpConfig(validRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config.contact.email).toBe("soporte@iti.edu.uy");
    expect(result.config.contact.schedule?.es).toBe("Lunes a viernes de 9 a 17");
    expect(result.config.contact.schedule?.en).toBe("Monday to Friday, 9 am to 5 pm");
    expect(result.config.contact.responseTime).toEqual({
      es: "Respondemos en 24 horas habiles",
    });
    expect(result.config.guide?.url).toBe("/dashboard");
    expect(result.config.categories).toHaveLength(2);
    expect(result.config.categories[0].items[1].id).toBe("tickets-2");
    expect(result.warnings).toEqual([]);
  });

  test("rechaza un archivo que no es un objeto", () => {
    for (const raw of [null, undefined, "texto", 42, []]) {
      const result = parseHelpConfig(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0]).toContain("JSON object");
    }
  });

  test("rechaza la configuracion sin correo de contacto", () => {
    const raw = validRaw();
    const result = parseHelpConfig({ ...raw, contact: { schedule: "9 a 17" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContain("contact.email is required");
  });

  test("rechaza un correo con formato invalido", () => {
    const raw = validRaw();
    const result = parseHelpConfig({ ...raw, contact: { email: "soporte-sin-arroba" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContain("contact.email is not a valid email address");
  });

  test("rechaza la configuracion sin categorias o sin preguntas usables", () => {
    const raw = validRaw();
    const withoutCategories = parseHelpConfig({ ...raw, categories: [] });
    expect(withoutCategories.ok).toBe(false);

    const emptyItems = parseHelpConfig({
      contact: { email: "soporte@iti.edu.uy" },
      categories: [{ id: "tickets", items: [] }],
    });
    expect(emptyItems.ok).toBe(false);
  });

  test("descarta una categoria o pregunta invalida y conserva el resto", () => {
    const result = parseHelpConfig({
      contact: { email: "soporte@iti.edu.uy" },
      categories: [
        {
          id: "tickets",
          items: [
            { question: "¿Cómo creo un ticket?", answer: "Desde Tickets." },
            { question: "Sin respuesta" },
          ],
        },
        { id: "", items: [{ question: "Sin id", answer: "No se puede" }] },
        {
          id: "loans",
          items: [{ question: "¿Cómo pido un préstamo?", answer: "Desde Préstamos." }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config.categories.map((category) => category.id)).toEqual(["tickets", "loans"]);
    expect(result.config.categories[0].items).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  test("ignora un enlace de guia invalido sin romper la pagina", () => {
    const raw = validRaw();
    const result = parseHelpConfig({ ...raw, guide: { label: "Sin url" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.guide).toBeUndefined();
    expect(result.warnings).toContain("guide.url is required when guide is present");
  });

  test("rechaza un enlace de guia con un esquema no permitido", () => {
    const raw = validRaw();
    const result = parseHelpConfig({ ...raw, guide: { url: "javascript:alert(1)" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.guide).toBeUndefined();
    expect(result.warnings).toContain("guide.url must start with / or http(s)://");
  });

  test("descarta una categoria cuyo id no sirve como identificador", () => {
    const result = parseHelpConfig({
      contact: { email: "soporte@iti.edu.uy" },
      categories: [
        {
          id: "cuenta y acceso",
          items: [{ question: "¿Cómo entro?", answer: "Con tu cédula." }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContain("categories must include at least one category with FAQ items");
    }
  });

  test("una categoria desconocida se conserva con su etiqueta propia", () => {
    const raw = {
      contact: { email: "soporte@iti.edu.uy" },
      categories: [
        {
          id: "wifi",
          label: { es: "Wi-Fi", en: "Wi-Fi" },
          items: [{ question: "¿Cómo me conecto?", answer: "Con la red ITI." }],
        },
      ],
    };
    const result = parseHelpConfig(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.categories[0].id).toBe("wifi");
    expect(result.config.categories[0].label?.es).toBe("Wi-Fi");
  });
});

describe("helpTextFor", () => {
  test("usa el ingles cuando existe y cae al espanol cuando falta", () => {
    const text = { es: "Hola", en: "Hello" };
    expect(helpTextFor(text, "en")).toBe("Hello");
    expect(helpTextFor(text, "es")).toBe("Hola");
    expect(helpTextFor({ es: "Hola" }, "en")).toBe("Hola");
  });
});

describe("filterHelpCategories", () => {
  const parsed = parseHelpConfig(validRaw());
  if (!parsed.ok) throw new Error("fixture invalida");
  const config: HelpConfig = parsed.config;

  test("sin busqueda devuelve todas las categorias", () => {
    expect(filterHelpCategories(config.categories, "", "es")).toHaveLength(2);
    expect(filterHelpCategories(config.categories, "   ", "es")).toHaveLength(2);
  });

  test("busca en pregunta y respuesta", () => {
    const byQuestion = filterHelpCategories(config.categories, "reabrir", "es");
    expect(byQuestion).toHaveLength(1);
    expect(byQuestion[0].items[0].id).toBe("tickets-2");

    const byAnswer = filterHelpCategories(config.categories, "Préstamos", "es");
    expect(byAnswer).toHaveLength(1);
    expect(byAnswer[0].id).toBe("loans");
  });

  test("ignora mayusculas y tildes", () => {
    expect(normalizeHelpSearch("PRÉSTAMO")).toBe("prestamo");
    const result = filterHelpCategories(config.categories, "prestamo", "es");
    expect(result).toHaveLength(1);
    expect(result[0].items[0].question.es).toBe("¿Cómo pido un préstamo?");
  });

  test("pide que aparezcan todas las palabras", () => {
    expect(filterHelpCategories(config.categories, "ticket reabrir", "es")).toHaveLength(1);
    expect(filterHelpCategories(config.categories, "ticket prestamo", "es")).toHaveLength(0);
  });

  test("busca en el idioma activo", () => {
    expect(filterHelpCategories(config.categories, "ticket", "en")).toHaveLength(1);
    expect(filterHelpCategories(config.categories, "loan", "en")).toHaveLength(1);
    expect(filterHelpCategories(config.categories, "loan", "es")).toHaveLength(0);
  });

  test("devuelve una lista vacia cuando no hay coincidencias", () => {
    expect(filterHelpCategories(config.categories, "impresora 3d", "es")).toEqual([]);
    expect(countHelpItems([])).toBe(0);
    expect(countHelpItems(config.categories)).toBe(3);
  });
});
