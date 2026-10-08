import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Splash } from "@/features/splash/Splash";
import { LoginPage } from "@/features/login/LoginPage";
import { WaitToLogin } from "@/features/login/WaitToLogin";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { InventoryPage } from "@/features/inventory/InventoryPage";
import { ProductDetail } from "@/features/inventory/ProductDetail";
import { ComponentDetail } from "@/features/inventory/ComponentDetail";
import { EquipmentForm } from "@/features/inventory/EquipmentForm";
import { EquipmentStatus } from "@/features/inventory/EquipmentStatus";
import { LocationsPage } from "@/features/locations/LocationsPage";
import { TicketList } from "@/features/tickets/TicketList";
import { TicketDetail } from "@/features/tickets/TicketDetail";
import { OolList } from "@/features/tickets/OolList";
import { LoansPage } from "@/features/loans/LoansPage";
import { ServiceList } from "@/features/services/ServiceList";
import { ServiceDetail } from "@/features/services/ServiceDetail";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { AdminDashboard } from "@/features/admin/AdminDashboard";
import { UserManagement } from "@/features/admin/UserManagement";
import { RolesConfig } from "@/features/admin/RolesConfig";
import { ActivityLog } from "@/features/admin/ActivityLog";
import { ReportsPage } from "@/features/admin/ReportsPage";
import { NotFoundPage } from "@/features/errors/NotFoundPage";
import { ForbiddenPage } from "@/features/errors/ForbiddenPage";
import { ServerErrorPage } from "@/features/errors/ServerErrorPage";
import { ROUTES } from "@/lib/constants";
import type { UserRole } from "@/lib/types";

const STAFF_ROLES: UserRole[] = ["root_admin", "admin", "tecnico"];

export const router = createBrowserRouter([
  {
    path: ROUTES.SPLASH,
    element: <Splash />,
  },
  {
    path: ROUTES.LOGIN,
    element: <LoginPage />,
  },
  {
    path: ROUTES.WAIT,
    element: <WaitToLogin />,
  },
  {
    path: ROUTES.NOT_FOUND,
    element: <NotFoundPage />,
  },
  {
    path: ROUTES.FORBIDDEN,
    element: <ForbiddenPage />,
  },
  {
    path: ROUTES.SERVER_ERROR,
    element: <ServerErrorPage />,
  },

  {
    path: "/dashboard",
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "inventory", element: <InventoryPage /> },
      {
        path: "inventory/nuevo",
        element: (
          <ProtectedRoute roles={STAFF_ROLES}>
            <EquipmentForm mode="product" />
          </ProtectedRoute>
        ),
      },
      {
        path: "inventory/nuevo-componente",
        element: (
          <ProtectedRoute roles={STAFF_ROLES}>
            <EquipmentForm mode="component" />
          </ProtectedRoute>
        ),
      },
      { path: "inventory/:id", element: <ProductDetail /> },
      {
        path: "inventory/:id/editar",
        element: (
          <ProtectedRoute roles={STAFF_ROLES}>
            <EquipmentForm mode="product" />
          </ProtectedRoute>
        ),
      },
      { path: "inventory/componente/:id", element: <ComponentDetail /> },
      {
        path: "inventory/componente/:id/editar",
        element: (
          <ProtectedRoute roles={STAFF_ROLES}>
            <EquipmentForm mode="component" />
          </ProtectedRoute>
        ),
      },
      { path: "equipment-status", element: <EquipmentStatus /> },
      {
        path: "locations",
        element: (
          <ProtectedRoute roles={STAFF_ROLES}>
            <LocationsPage />
          </ProtectedRoute>
        ),
      },
      { path: "tickets", element: <TicketList /> },
      { path: "tickets/:id", element: <TicketDetail /> },
      {
        path: "tickets/ool",
        element: (
          <ProtectedRoute roles={STAFF_ROLES}>
            <OolList />
          </ProtectedRoute>
        ),
      },
      {
        path: "loans",
        element: (
          <ProtectedRoute roles={STAFF_ROLES}>
            <LoansPage />
          </ProtectedRoute>
        ),
      },
      { path: "service-requests", element: <ServiceList /> },
      { path: "service-requests/:id", element: <ServiceDetail /> },
      { path: "profile", element: <ProfilePage /> },
    ],
  },

  {
    path: "/admin",
    element: (
      <ProtectedRoute roles={["root_admin", "admin"]}>
        <AdminLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <AdminDashboard /> },
      { path: "users", element: <UserManagement /> },
      { path: "roles", element: <RolesConfig /> },
      { path: "logs", element: <ActivityLog /> },
      { path: "reports", element: <ReportsPage /> },
    ],
  },

  {
    path: "*",
    element: <Navigate to={ROUTES.NOT_FOUND} replace />,
  },
]);

// Routeado de paginas y su funcionamiento con middleware
