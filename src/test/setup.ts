import { beforeEach } from "bun:test";
import { setLang } from "@/i18n";
import { mockTokenVersions } from "@/mocks/data/users";

// Los tests parten del espanol, sin depender del entorno donde corren
setLang("es");

// Cambiar la contrasena (o resetearla desde admin) sube la version del token en
// el mock, y ese estado vive en el modulo. Sin reiniciarlo, se filtra a los
// tests de otras pantallas, que arman el token como `mock-token-<id>` (version
// 0) y terminan fallando por permisos segun el orden en que bun carga los
// archivos. Cada test arranca con todas las sesiones en la version inicial.
beforeEach(() => {
  for (const key of Object.keys(mockTokenVersions)) delete mockTokenVersions[key];
});
