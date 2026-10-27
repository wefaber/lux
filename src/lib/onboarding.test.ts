import { describe, expect, test } from "bun:test";
import {
  ONBOARDING_STORAGE_PREFIX,
  ONBOARDING_VERSION,
  hasCompletedOnboarding,
  isLastStep,
  markOnboardingCompleted,
  nextStepIndex,
  onboardingContentFor,
  onboardingProgress,
  onboardingStepsFor,
  onboardingStorageKey,
  previousStepIndex,
  readOnboardingRecord,
  type OnboardingStorage,
} from "./onboarding";

// Storage en memoria: los tests de logica no dependen del navegador
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: OnboardingStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
  return { storage, map };
}

describe("primera vez por usuario", () => {
  test("la clave lleva el prefijo y el id del usuario", () => {
    expect(onboardingStorageKey("u-sol-1")).toBe(`${ONBOARDING_STORAGE_PREFIX}u-sol-1`);
  });

  test("sin registro no esta completada", () => {
    const { storage } = memoryStorage();
    expect(hasCompletedOnboarding("u-sol-1", storage)).toBe(false);
    expect(readOnboardingRecord("u-sol-1", storage)).toBeNull();
  });

  test("al marcarla queda completada con version y fecha", () => {
    const { storage, map } = memoryStorage();
    const now = new Date("2026-10-21T12:00:00Z");
    expect(markOnboardingCompleted("u-sol-1", storage, now)).toBe(true);

    const record = readOnboardingRecord("u-sol-1", storage);
    expect(record).toEqual({ version: ONBOARDING_VERSION, completedAt: now.toISOString() });
    expect(map.get(onboardingStorageKey("u-sol-1"))).toBe(
      JSON.stringify({ version: ONBOARDING_VERSION, completedAt: now.toISOString() }),
    );
  });

  test("cada usuario tiene su propio registro", () => {
    const { storage } = memoryStorage();
    markOnboardingCompleted("u-sol-1", storage);
    expect(hasCompletedOnboarding("u-sol-1", storage)).toBe(true);
    expect(hasCompletedOnboarding("u-tec-1", storage)).toBe(false);
    expect(hasCompletedOnboarding("", storage)).toBe(false);
  });

  test("un registro roto o de otra version vuelve a mostrar la guia", () => {
    const broken = memoryStorage({ [onboardingStorageKey("u-1")]: "{no es json" });
    expect(hasCompletedOnboarding("u-1", broken.storage)).toBe(false);

    const oldVersion = memoryStorage({
      [onboardingStorageKey("u-1")]: JSON.stringify({ version: 0, completedAt: "2025-01-01" }),
    });
    expect(hasCompletedOnboarding("u-1", oldVersion.storage)).toBe(false);

    const noDate = memoryStorage({
      [onboardingStorageKey("u-1")]: JSON.stringify({ version: ONBOARDING_VERSION }),
    });
    expect(hasCompletedOnboarding("u-1", noDate.storage)).toBe(false);
  });

  test("sin storage (modo privado) no rompe y no da por vista la guia", () => {
    expect(() => markOnboardingCompleted("u-1", null)).not.toThrow();
    expect(markOnboardingCompleted("u-1", null)).toBe(false);
    expect(hasCompletedOnboarding("u-1", null)).toBe(false);
  });

  test("un storage que falla al guardar no rompe", () => {
    const failing: OnboardingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(markOnboardingCompleted("u-1", failing)).toBe(false);
  });
});

describe("pasos por rol", () => {
  test("el solicitante recorre el flujo de pedidos", () => {
    const steps = onboardingStepsFor("solicitante");
    expect(steps).toEqual([
      "welcome",
      "reportTicket",
      "requestService",
      "loans",
      "preferences",
    ]);
  });

  test("el tecnico suma la cola y las herramientas del area", () => {
    const steps = onboardingStepsFor("tecnico");
    expect(steps[0]).toBe("welcome");
    expect(steps.at(-1)).toBe("preferences");
    expect(steps).toContain("workQueue");
    expect(steps).toContain("manageRequests");
    expect(steps).toContain("staffTools");
    expect(steps).not.toContain("adminPanel");
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps.length).toBeLessThanOrEqual(6);
  });

  test("el admin y el root_admin agregan el panel de administracion", () => {
    const admin = onboardingStepsFor("admin");
    const root = onboardingStepsFor("root_admin");
    expect(admin).toEqual(root);
    expect(admin).toContain("adminPanel");
    expect(admin.at(-1)).toBe("preferences");
    expect(admin.length).toBeLessThanOrEqual(6);
  });

  test("todos los recorridos tienen entre 4 y 6 pasos y terminan en preferencias", () => {
    for (const role of ["solicitante", "tecnico", "admin", "root_admin"] as const) {
      const steps = onboardingStepsFor(role);
      expect(steps.length).toBeGreaterThanOrEqual(4);
      expect(steps.length).toBeLessThanOrEqual(6);
      expect(steps[0]).toBe("welcome");
      expect(steps.at(-1)).toBe("preferences");
      expect(new Set(steps).size).toBe(steps.length);
    }
    expect(onboardingStepsFor(undefined)).toEqual([]);
  });
});

describe("contenido por rol", () => {
  test("cada paso tiene titulo, descripcion y a lo sumo tres puntos", () => {
    for (const role of ["solicitante", "tecnico", "admin", "root_admin"] as const) {
      for (const step of onboardingStepsFor(role)) {
        const content = onboardingContentFor(step, role);
        expect(content.title.length).toBeGreaterThan(0);
        expect(content.description.length).toBeGreaterThan(0);
        expect(content.points.length).toBeLessThanOrEqual(3);
      }
    }
  });

  test("la bienvenida muestra el flujo de cada lado", () => {
    const requester = onboardingContentFor("welcome", "solicitante");
    const staff = onboardingContentFor("welcome", "tecnico");
    expect(requester.flow).toHaveLength(3);
    expect(staff.flow).toHaveLength(3);
    expect(requester.description).not.toBe(staff.description);
    expect(requester.flow).not.toEqual(staff.flow);
  });

  test("el root_admin ve su propia bajada del panel", () => {
    const admin = onboardingContentFor("adminPanel", "admin");
    const root = onboardingContentFor("adminPanel", "root_admin");
    expect(admin.description).not.toBe(root.description);
    expect(admin.title).toBe(root.title);
  });

  test("preferencias no lista puntos: son controles", () => {
    const content = onboardingContentFor("preferences", "solicitante");
    expect(content.points).toEqual([]);
    expect(content.flow).toBeUndefined();
  });
});

describe("avance y retroceso", () => {
  test("avanza de a un paso y frena en el ultimo", () => {
    expect(nextStepIndex(0, 5)).toBe(1);
    expect(nextStepIndex(3, 5)).toBe(4);
    expect(nextStepIndex(4, 5)).toBe(4);
    expect(isLastStep(4, 5)).toBe(true);
    expect(isLastStep(3, 5)).toBe(false);
  });

  test("retrocede de a un paso y frena en el primero", () => {
    expect(previousStepIndex(3, 5)).toBe(2);
    expect(previousStepIndex(0, 5)).toBe(0);
  });

  test("indices fuera de rango se recortan", () => {
    expect(nextStepIndex(99, 5)).toBe(4);
    expect(previousStepIndex(-3, 5)).toBe(0);
    expect(nextStepIndex(0, 0)).toBe(0);
    expect(isLastStep(0, 0)).toBe(false);
  });

  test("el progreso cuenta el paso actual", () => {
    expect(onboardingProgress(0, 5)).toBe(20);
    expect(onboardingProgress(2, 5)).toBe(60);
    expect(onboardingProgress(4, 5)).toBe(100);
    expect(onboardingProgress(0, 0)).toBe(0);
  });
});
