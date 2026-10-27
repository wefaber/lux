import type { profile as es } from "../es/profile";
import type { Translation } from "../types";

export const profile: Translation<typeof es> = {
  "profile.title": "Profile",
  "profile.subtitle": "Your information and preferences",
  "profile.field.name": "Full name",
  "profile.field.dni": "ID number",
  "profile.field.email": "Email",
  "profile.field.role": "Role",
  "profile.password.title": "Change password",
  "profile.password.current": "Current password",
  "profile.password.new": "New password",
  "profile.password.confirm": "Confirm new password",
  "profile.password.mismatch": "The passwords do not match.",
  "profile.password.failed": "Could not change the password",
  "profile.password.submit": "Update password",
  "profile.a11y.title": "Accessibility",
  "profile.a11y.theme": "Theme",
  "profile.a11y.themeHelp": "Light or dark",
  "profile.a11y.fontSize": "Font size",
  "profile.a11y.fontSizeHelp": "S · M · L · XL",
  "profile.a11y.contrast": "High contrast",
  "profile.a11y.contrastHelp": "Clearer borders",
  "profile.a11y.dyslexic": "OpenDyslexic font",
  "profile.a11y.dyslexicHelp": "Easier to read with dyslexia",
  "profile.a11y.language": "Language",
  "profile.a11y.languageHelp": "Spanish or English",
};
