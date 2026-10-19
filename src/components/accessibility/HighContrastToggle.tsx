import { Contrast } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "@/components/ui/button";

export function HighContrastToggle() {
  const { highContrast, toggleHighContrast } = useTheme();
  const { t } = useI18n();
  return (
    <Button
      variant={highContrast ? "secondary" : "ghost"}
      size="icon"
      onClick={toggleHighContrast}
      aria-label={t("a11y.highContrast")}
      aria-pressed={highContrast}
    >
      <Contrast className="h-4 w-4" />
    </Button>
  );
}

// Boton de logica de contraste alto
