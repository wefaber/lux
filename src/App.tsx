import { RouterProvider } from "react-router-dom";
import { router } from "@/router";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { I18nProvider } from "@/hooks/useI18n";
import { ErrorBoundary } from "@/components/errors/ErrorBoundary";

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <ErrorBoundary>
            <RouterProvider router={router} />
          </ErrorBoundary>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
