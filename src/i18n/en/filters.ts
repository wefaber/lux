import type { filters as es } from "../es/filters";
import type { Translation } from "../types";

export const filters: Translation<typeof es> = {
  "filters.dateRange": "Date range",
  "filters.from": "From",
  "filters.to": "To",
  "filters.clear": "Clear the date range",
  "filters.invalidOrder": "The “from” date can't be after the “to” date.",
  "filters.emptyRange": "No results in that date range.",
};
