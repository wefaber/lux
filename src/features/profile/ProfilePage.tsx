import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { Lock, Type } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { gql } from "@/lib/utils";
import { ROLE_CONFIG, ROLE_LABELS, SPRING_TRANSITION } from "@/lib/constants";
import { validatePassword } from "@/lib/validation";
import type { User } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ThemeSwitcher } from "@/components/accessibility/ThemeSwitcher";
import { FontSizeControl } from "@/components/accessibility/FontSizeControl";
import { HighContrastToggle } from "@/components/accessibility/HighContrastToggle";
import { Separator } from "@/components/ui/separator";

const CHANGE_PASSWORD_MUTATION = `
 mutation ChangePassword($currentPassword: String!, $newPassword: String!) {
 changePassword(currentPassword: $currentPassword, newPassword: $newPassword)
 }
`;

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

// Datos de la cuenta: se muestran a la derecha en escritorio y debajo en el telefono
function ProfileFields({ user }: { user: User }) {
  const fields = [
    { label: "Nombre completo", value: user.name },
    { label: "Cédula", value: user.dni },
    { label: "Email", value: user.email },
    { label: "Rol", value: ROLE_LABELS[user.role] },
  ];
  return (
    <>
      {fields.map(({ label, value }) => (
        <div key={label}>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mb-0.5">{label}</p>
          <p className="text-sm text-foreground">{value}</p>
        </div>
      ))}
    </>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  const { dyslexicFont, toggleDyslexicFont } = useTheme();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError("");
    setPwSuccess(false);
    if (newPw !== confirmPw) {
      setPwError("Las contraseñas no coinciden.");
      return;
    }
    const invalid = validatePassword(newPw);
    if (invalid) {
      setPwError(invalid);
      return;
    }
    setSaving(true);
    try {
      await gql(CHANGE_PASSWORD_MUTATION, { currentPassword: currentPw, newPassword: newPw });
      setPwSuccess(true);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Error al cambiar contraseña");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Perfil</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Tu información y preferencias</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING_TRANSITION}
        className="space-y-4"
      >
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-5">
              <Avatar className="h-16 w-16 shrink-0">
                <AvatarFallback className="text-2xl font-semibold">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-foreground truncate">{user.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge color={ROLE_CONFIG[user.role].color}>{ROLE_CONFIG[user.role].label}</Badge>
                  <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                </div>
              </div>
              <div className="hidden sm:grid grid-cols-2 gap-x-10 gap-y-3 shrink-0">
                <ProfileFields user={user} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-10 gap-y-3 mt-5 sm:hidden">
              <ProfileFields user={user} />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <Card>
            <CardHeader>
              <CardTitle>
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Cambiar contraseña
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="current-pw">Contraseña actual</Label>
                  <Input
                    id="current-pw"
                    type="password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-pw">Nueva contraseña</Label>
                  <Input
                    id="new-pw"
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-pw">Confirmar nueva contraseña</Label>
                  <Input
                    id="confirm-pw"
                    type="password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    required
                  />
                </div>
                {pwError && (
                  <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                    {pwError}
                  </div>
                )}
                {pwSuccess && (
                  <div className="rounded-xl bg-[rgba(52,199,89,0.08)] border border-success-border p-3 text-sm text-success">
                    Contraseña actualizada correctamente.
                  </div>
                )}
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={saving}>
                    {saving ? "Guardando..." : "Actualizar contraseña"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <div className="flex items-center gap-2">
                  <Type className="h-4 w-4" />
                  Accesibilidad
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Tema</p>
                  <p className="text-xs text-muted-foreground">Claro u oscuro</p>
                </div>
                <ThemeSwitcher />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Tamaño de fuente</p>
                  <p className="text-xs text-muted-foreground">S · M · L · XL</p>
                </div>
                <FontSizeControl />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Alto contraste</p>
                  <p className="text-xs text-muted-foreground">Mayor visibilidad de bordes</p>
                </div>
                <HighContrastToggle />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Fuente OpenDyslexic</p>
                  <p className="text-xs text-muted-foreground">Mayor legibilidad para dislexia</p>
                </div>
                <button
                  onClick={toggleDyslexicFont}
                  className={`relative h-6 w-11 rounded-full transition-colors cursor-pointer ${dyslexicFont ? "bg-primary" : "bg-black/20 dark:bg-card/20"}`}
                  role="switch"
                  aria-checked={dyslexicFont}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${dyslexicFont ? "" : "-translate-x-5"}`}
                  />
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </div>
  );
}
