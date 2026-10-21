import type { MessageKey } from "@/i18n";
import { isStaff } from "./roles";
import type { UserRole } from "./types";

// Guia de primer ingreso: que pasos ve cada rol, el texto de cada paso y la
// logica de "ya la hizo" / avanzar y retroceder. Sin React, para poder probarla.

/** Pasos posibles. Cada uno existe en los tres recorridos salvo los exclusivos. */
export type OnboardingStepId =
  | "welcome"
  | "reportTicket"
  | "workQueue"
  | "requestService"
  | "manageRequests"
  | "loans"
  | "staffTools"
  | "adminPanel"
  | "preferences";

const REQUESTER_STEPS: OnboardingStepId[] = [
  "welcome",
  "reportTicket",
  "requestService",
  "loans",
  "preferences",
];

const TECH_STEPS: OnboardingStepId[] = [
  "welcome",
  "workQueue",
  "manageRequests",
  "staffTools",
  "preferences",
];

// El admin agrega el panel de gestion; el root_admin ve el mismo recorrido.
const ADMIN_STEPS: OnboardingStepId[] = [
  "welcome",
  "workQueue",
  "manageRequests",
  "staffTools",
  "adminPanel",
  "preferences",
];

/** Recorrido de la guia para un rol (4 a 6 pasos, siempre termina en preferencias). */
export function onboardingStepsFor(role: UserRole | undefined): OnboardingStepId[] {
  if (!role) return [];
  if (role === "solicitante") return [...REQUESTER_STEPS];
  if (role === "tecnico") return [...TECH_STEPS];
  return [...ADMIN_STEPS];
}

export interface OnboardingStepContent {
  title: MessageKey;
  description: MessageKey;
  /** Puntos clave del paso (0 a 3, textos cortos). */
  points: MessageKey[];
  /** Flujo habitual, solo en la bienvenida. */
  flow?: MessageKey[];
}

// Texto por paso. La bienvenida y el panel cambian segun sea personal o
// administrador, y el root_admin tiene su propia bajada de permisos.
export function onboardingContentFor(
  step: OnboardingStepId,
  role: UserRole | undefined,
): OnboardingStepContent {
  const staff = isStaff(role);
  const root = role === "root_admin";
  switch (step) {
    case "welcome":
      return staff
        ? {
            title: "onboarding.welcome.title",
            description: "onboarding.welcome.staff",
            points: [
              "onboarding.welcome.point1",
              "onboarding.welcome.point2",
              "onboarding.welcome.point3",
            ],
            flow: ["onboarding.flow.incoming", "onboarding.flow.resolve", "onboarding.flow.close"],
          }
        : {
            title: "onboarding.welcome.title",
            description: "onboarding.welcome.requester",
            points: [
              "onboarding.welcome.point1",
              "onboarding.welcome.point2",
              "onboarding.welcome.point3",
            ],
            flow: ["onboarding.flow.report", "onboarding.flow.follow", "onboarding.flow.resolved"],
          };
    case "reportTicket":
      return {
        title: "onboarding.reportTicket.title",
        description: "onboarding.reportTicket.description",
        points: [
          "onboarding.reportTicket.point1",
          "onboarding.reportTicket.point2",
          "onboarding.reportTicket.point3",
        ],
      };
    case "workQueue":
      return {
        title: "onboarding.workQueue.title",
        description: "onboarding.workQueue.description",
        points: [
          "onboarding.workQueue.point1",
          "onboarding.workQueue.point2",
          "onboarding.workQueue.point3",
        ],
      };
    case "requestService":
      return {
        title: "onboarding.requestService.title",
        description: "onboarding.requestService.description",
        points: [
          "onboarding.requestService.point1",
          "onboarding.requestService.point2",
          "onboarding.requestService.point3",
        ],
      };
    case "manageRequests":
      return {
        title: "onboarding.manageRequests.title",
        description: "onboarding.manageRequests.description",
        points: [
          "onboarding.manageRequests.point1",
          "onboarding.manageRequests.point2",
          "onboarding.manageRequests.point3",
        ],
      };
    case "loans":
      return {
        title: "onboarding.loans.title",
        description: "onboarding.loans.description",
        points: [
          "onboarding.loans.point1",
          "onboarding.loans.point2",
          "onboarding.loans.point3",
        ],
      };
    case "staffTools":
      return {
        title: "onboarding.staffTools.title",
        description: "onboarding.staffTools.description",
        points: [
          "onboarding.staffTools.point1",
          "onboarding.staffTools.point2",
          "onboarding.staffTools.point3",
        ],
      };
    case "adminPanel":
      return {
        title: "onboarding.adminPanel.title",
        description: root
          ? "onboarding.adminPanel.description.root"
          : "onboarding.adminPanel.description.admin",
        points: [
          "onboarding.adminPanel.point1",
          "onboarding.adminPanel.point2",
          "onboarding.adminPanel.point3",
        ],
      };
    case "preferences":
      return {
        title: "onboarding.preferences.title",
        description: "onboarding.preferences.description",
        points: [],
      };
  }
}

// ── Persistencia ─────────────────────────────────────────────────────────────

export const ONBOARDING_STORAGE_PREFIX = "lux_onboarding_";
// Si un dia cambia el contenido, subir la version vuelve a mostrar la guia una
// vez: lo guardado con otra version no cuenta como completada.
export const ONBOARDING_VERSION = 1;

export interface OnboardingRecord {
  version: number;
  completedAt: string;
}

export type OnboardingStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): OnboardingStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Navegacion privada con storage bloqueado
    return null;
  }
}

/** Clave por usuario: dos cuentas en el mismo navegador no se pisan. */
export function onboardingStorageKey(userId: string): string {
  return `${ONBOARDING_STORAGE_PREFIX}${userId}`;
}

/** Lo guardado, si es de esta version; si no, null (se vuelve a mostrar). */
export function readOnboardingRecord(
  userId: string,
  storage: OnboardingStorage | null = defaultStorage(),
): OnboardingRecord | null {
  if (!userId || !storage) return null;
  try {
    const raw = storage.getItem(onboardingStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingRecord> | null;
    if (parsed?.version !== ONBOARDING_VERSION || typeof parsed.completedAt !== "string") {
      return null;
    }
    return { version: parsed.version, completedAt: parsed.completedAt };
  } catch {
    return null;
  }
}

export function hasCompletedOnboarding(
  userId: string | undefined,
  storage: OnboardingStorage | null = defaultStorage(),
): boolean {
  return !!userId && readOnboardingRecord(userId, storage) !== null;
}

/** Marca la guia como vista (al terminar, omitir o cerrar). */
export function markOnboardingCompleted(
  userId: string,
  storage: OnboardingStorage | null = defaultStorage(),
  now: Date = new Date(),
): boolean {
  if (!userId || !storage) return false;
  try {
    const record: OnboardingRecord = {
      version: ONBOARDING_VERSION,
      completedAt: now.toISOString(),
    };
    storage.setItem(onboardingStorageKey(userId), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

// ── Avance y retroceso ───────────────────────────────────────────────────────

function clamp(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
}

/** Indice siguiente, sin pasarse del ultimo paso. */
export function nextStepIndex(index: number, total: number): number {
  return clamp(index + 1, total);
}

/** Indice anterior, sin bajar del primero. */
export function previousStepIndex(index: number, total: number): number {
  return clamp(index - 1, total);
}

export function isLastStep(index: number, total: number): boolean {
  return total > 0 && index >= total - 1;
}

/** Porcentaje completado hasta el paso actual (el primero ya cuenta). */
export function onboardingProgress(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round(((clamp(index, total) + 1) / total) * 100);
}
