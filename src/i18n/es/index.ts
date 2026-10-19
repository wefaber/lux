import { app } from "./app";
import { core } from "./core";
import { domain } from "./domain";
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
import { validation } from "./validation";

// Espanol: la fuente de las claves (ver ../index.ts). Un diccionario por
// dominio, todos aplanados en un solo objeto con claves "dominio.seccion.texto"
export const es = {
  ...core,
  ...app,
  ...domain,
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
  ...validation,
} as const;

// Los mismos diccionarios sin mezclar: el test de completitud detecta con esto
// una clave repetida en dos archivos (el spread la taparia)
export const esParts = [
  core,
  app,
  domain,
  errors,
  services,
  loans,
  inventory,
  tickets,
  dashboard,
  profile,
  validation,
  reservations,
  locations,
  admin,
] as const;
