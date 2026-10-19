import type { MessageKey } from "..";
import { app } from "./app";
import { core } from "./core";
import { domain } from "./domain";
import { errors } from "./errors";
import { services } from "./services";
import { loans } from "./loans";
import { inventory } from "./inventory";
import { tickets } from "./tickets";
import { dashboard } from "./dashboard";
import { profile } from "./profile";
import { validation } from "./validation";

// Ingles: tiene que tener exactamente las claves del espanol
export const en: Record<MessageKey, string> = {
  ...core,
  ...app,
  ...domain,
  ...errors,
  ...services,
  ...loans,
  ...inventory,
  ...tickets,
  ...dashboard,
  ...profile,
  ...validation,
};
