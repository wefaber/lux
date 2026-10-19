import { adminCases } from "./admin";
import { apiCases } from "./api";
import { authCases } from "./auth";
import { crudCases } from "./crud";
import { inventoryCases } from "./inventory";
import { loanCases } from "./loans";
import { restCases } from "./rest";
import { rnfCases } from "./rnf";
import { serviceCases } from "./services";
import { ticketCases } from "./tickets";
import type { TestCase } from "./types";

export { CATALOG } from "./catalog";
export { DECISION_TABLES } from "./decision-tables";

export const CASES: TestCase[] = [
  ...authCases,
  ...ticketCases,
  ...loanCases,
  ...serviceCases,
  ...inventoryCases,
  ...adminCases,
  ...rnfCases,
  ...apiCases,
  ...crudCases,
  ...restCases,
];

const ids = new Set<string>();
for (const c of CASES) {
  if (ids.has(c.id)) throw new Error(`ID de caso duplicado: ${c.id}`);
  ids.add(c.id);
}
