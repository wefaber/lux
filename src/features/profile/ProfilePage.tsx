import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { Lock, Type } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";
import { gql, initials, errorMessage } from "@/lib/utils";
import { ROLE_CONFIG, ROLE_LABELS, SPRING_TRANSITION } from "@/lib/constants";
import { validatePassword } from "@/lib/validation";
import type { User } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LanguageSwitcher } from "@/components/accessibility/LanguageSwitcher";
import { ThemeSwitcher } from "@/components/accessibility/ThemeSwitcher";
import { FontSizeControl } from "@/components/accessibility/FontSizeControl";
import { HighContrastToggle } from "@/components/accessibility/HighContrastToggle";
import { Separator } from "@/components/ui/separator";
import { ErrorAlert } from "@/components/ui/error-alert";

const CHANGE_PASSWORD_MUTATION = `
 mutation ChangePassword($currentPassword: String!, $newPassword: String!) {
 changePassword(currentPassword: $currentPassword, newPassword: $newPassword)
 }
`;

// Datos de la cuenta: se muestran a la derecha en escritorio y debajo en el telefono
function ProfileFields({ user }: { user: User }) {
  const { t } = useI18n();
  const fields = [
    { label: t("profile.field.name"), value: user.name },
    { label: t("profile.field.dni"), value: user.dni },
    { label: t("profile.field.email"), value: user.email },
    { label: t("profile.field.role"), value: ROLE_LABELS[user.role] },
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
  const { t } = useI18n();
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
      setPwError(t("profile.password.mismatch"));
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
      setPwError(errorMessage(err, t("profile.password.failed")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("profile.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("profile.subtitle")}</p>
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
                  {t("profile.password.title")}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="current-pw">{t("profile.password.current")}</Label>
                  <Input
                    id="current-pw"
                    type="password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-pw">{t("profile.password.new")}</Label>
                  <Input
                    id="new-pw"
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-pw">{t("profile.password.confirm")}</Label>
                  <Input
                    id="confirm-pw"
                    type="password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    required
                  />
                </div>
                <ErrorAlert>{pwError}</ErrorAlert>
                {pwSuccess && (
                  <div className="rounded-xl bg-[rgba(52,199,89,0.08)] border border-success-border p-3 text-sm text-success">
                    {t("profile.password.success")}
                  </div>
                )}
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={saving}>
                    {saving ? t("common.saving") : t("profile.password.submit")}
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
                  {t("profile.a11y.title")}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{t("profile.a11y.theme")}</p>
                  <p className="text-xs text-muted-foreground">{t("profile.a11y.themeHelp")}</p>
                </div>
                <ThemeSwitcher />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("profile.a11y.language")}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("profile.a11y.languageHelp")}</p>
                </div>
                <LanguageSwitcher />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("profile.a11y.fontSize")}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("profile.a11y.fontSizeHelp")}</p>
                </div>
                <FontSizeControl />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("profile.a11y.contrast")}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("profile.a11y.contrastHelp")}</p>
                </div>
                <HighContrastToggle />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("profile.a11y.dyslexic")}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("profile.a11y.dyslexicHelp")}</p>
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
