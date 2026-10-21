import type { locations as es } from "../es/locations";
import type { Translation } from "../types";

export const locations: Translation<typeof es> = {
  "locations.title": "Locations",
  "locations.subtitle":
    "Laboratories, classrooms and offices. The code (L1 = Laboratory 1) starts the ID of their equipment: L1-PC3.",
  "locations.new": "New location",
  "locations.empty": "There are no registered locations",
  "locations.col.code": "Code",
  "locations.col.equipment": "Equipment",
  "locations.col.updated": "Updated",
  "locations.deleteBlocked":
    "It has equipment: move it to another location to be able to delete it",
  "locations.form.titleEdit": "Edit location",
  "locations.form.description": "Its code (L1, A2...) starts the ID of the equipment it holds.",
  "locations.form.number": "Number",
  "locations.form.codeLocked":
    "Code {code}: it cannot be changed, {count} equipment item(s) use it in their machine ID.",
  "locations.form.codeHint": "Code: {code}. Its equipment is named {code}-PC1, {code}-PRY1…",
  "locations.form.codeEmpty": "The code comes from the type and the number (L1 = Laboratory 1).",
  "locations.form.namePlaceholder": "E.g.: Laboratory 3",
  "locations.form.saveChanges": "Save changes",
  "locations.form.submit": "Create location",
  "locations.form.failed": "Could not save the location",
  "locations.delete.title": "Delete location",
  "locations.delete.description": "{name} ({code}) no longer appears in filters and forms.",
  "locations.delete.submitting": "Deleting...",
  "locations.delete.failed": "Could not delete the location",
};
