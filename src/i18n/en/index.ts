import type { MessageKey } from "..";
import { app } from "./app";
import { core } from "./core";
import { domain } from "./domain";
import { filters } from "./filters";
import { errors } from "./errors";
import { comments } from "./comments";
import { admin } from "./admin";
import { locations } from "./locations";
import { reservations } from "./reservations";
import { services } from "./services";
import { loans } from "./loans";
import { inventory } from "./inventory";
import { tickets } from "./tickets";
import { dashboard } from "./dashboard";
import { profile } from "./profile";
import { onboarding } from "./onboarding";
import { help } from "./help";
import { validation } from "./validation";

// Ingles: tiene que tener exactamente las claves del espanol
export const en: Record<MessageKey, string> = {
  ...core,
  ...app,
  ...domain,
  ...filters,
  ...errors,
  ...comments,
  ...admin,
  ...locations,
  ...reservations,
  ...services,
  ...loans,
  ...inventory,
  ...tickets,
  ...dashboard,
  ...profile,
  ...onboarding,
  ...help,
  ...validation,
};
