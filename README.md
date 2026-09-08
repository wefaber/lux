# Lux — SGRSI

IT Resource and Service Management System (SGRSI) for UTU, a Uruguayan public technical education institution.

Web platform that centralizes the administration of IT equipment, technical support tickets, equipment loans, and service requests for an educational institution. It operates with four differentiated roles: **Super Admin**, **Admin**, **Technician**, and **Requester**.

## Tech stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | [Bun](https://bun.sh) | latest |
| Bundler | [Vite](https://vite.dev) | 8.x |
| UI | [React](https://react.dev) | 19.x |
| Language | [TypeScript](https://typescriptlang.org) | 6.x |
| Styling | [TailwindCSS](https://tailwindcss.com) | 4.x |
| Base components | [Radix UI](https://radix-ui.com) | 1.x |
| Routing | [React Router](https://reactrouter.com) | 7.x |
| Charts | [Recharts](https://recharts.org) | 2.x |
| Animations | [Motion](https://motion.dev) | 12.x |
| Icons | [Lucide React](https://lucide.dev) | 0.5.x |
| Mocking | [MSW](https://mswjs.io) | 2.x |
| Linting | [oxlint](https://oxc.rs) | 1.x |

Also in use: the React Compiler (via `babel-plugin-react-compiler`), `jsqr` for QR scanning, `react-qr-code` for QR generation, and `web-haptics` for haptic feedback.

### Why TailwindCSS

TailwindCSS was chosen as the styling framework for three main reasons:

1. **Utility over opinion**. Unlike Bootstrap or MUI, Tailwind does not impose a prefabricated visual vocabulary. This allowed building a custom visual identity aligned with the system's initial design sketches, without overriding a third-party theme.

2. **Zero runtime with Vite**. Tailwind v4 works as a native Vite plugin via `@tailwindcss/vite`, generating only the CSS actually used at build time. There is no runtime cost in production, unlike CSS-in-JS solutions.

3. **Accessible design tokens**. Design variables (`--color-*`, `--font-size-*`) map directly to `data-*` attributes on the `<html>` element, enabling accessibility features (dark theme, high contrast, font size, dyslexic font) without per-component conditional logic.

## Project structure

```
lux/
├── public/               # Favicon, SVG assets, MSW service worker
├── src/
│   ├── assets/           # Static images
│   ├── components/       # Reusable components
│   │   ├── accessibility/  # FontSizeControl, HighContrastToggle, ThemeSwitcher
│   │   ├── auth/           # ProtectedRoute (role-based guard)
│   │   ├── charts/         # BarChart, PieChart (Recharts wrappers)
│   │   ├── layout/         # AppLayout, AdminLayout, Sidebar, Topbar, TabBar
│   │   ├── skeletons/      # Loading states (Card, Table, Wizard)
│   │   └── ui/             # Primitives (Button, Card, Dialog, Input, Select, ...) + QrCode/QrScanner
│   ├── features/         # Business pages and modules
│   │   ├── admin/          # Admin dashboard, UserManagement, RolesConfig, ActivityLog
│   │   ├── dashboard/      # Main dashboard with statistics
│   │   ├── errors/         # 403, 404, 500
│   │   ├── inventory/      # Inventory, product/component detail, forms
│   │   ├── loans/          # Loans, loan and return forms
│   │   ├── login/          # Login and WaitToLogin
│   │   ├── profile/        # User profile
│   │   ├── services/       # Service requests, detail and form
│   │   ├── splash/         # Welcome screen
│   │   └── tickets/        # Tickets, detail, multi-step wizard, OOL queue
│   ├── hooks/            # Application hooks
│   │   ├── useAuth.ts      # Authentication and role control
│   │   ├── useTheme.ts     # Theme, contrast, font size, dyslexic font
│   │   ├── useHaptics.ts   # Haptic feedback
│   │   └── useSkeleton.ts  # Loading states for components
│   ├── lib/              # Shared types, constants, utilities
│   │   ├── types.ts        # Domain interfaces (User, Product, Ticket, Loan, ...)
│   │   ├── constants.ts    # Routes, status configurations, labels
│   │   └── utils.ts        # gql() function, cn (classnames), formatters
│   ├── mocks/            # Mock Service Worker (simulated backend)
│   │   ├── data/           # Test data (users, equipment, tickets, loans, services)
│   │   ├── handlers.ts     # Mocked GraphQL resolvers
│   │   ├── schema.ts       # System GraphQL schema
│   │   ├── generators.ts   # Data generators (activity logs, etc.)
│   │   └── browser.ts      # Worker configuration for the browser
│   └── router/
│       └── index.tsx       # Route tree with lazy loading and role guards
├── docs/                 # Project documentation (architecture, full-stack plan)
├── package.json
├── vite.config.ts
├── tsconfig.json
└── bun.lock
```

### Layer separation

The codebase follows a strict logical separation:

| Layer | Directory | Responsibility |
|-------|-----------|----------------|
| **Presentation** | `features/`, `components/` | Declarative UI. JSX and component composition only. |
| **State / Logic** | `hooks/` | Global state (auth, theme), business rules, side effects. |
| **Infrastructure** | `lib/`, `mocks/`, `router/` | Types, constants, API communication, routing. |

No `features/` component contains business logic: it is always delegated to hooks via `useAuth()`, `useTheme()`, or to the mock backend through the `gql()` function. Styling is fully separated from markup: TailwindCSS is applied through utility classes, with no CSS-in-JS and no inline styles except for specific dynamic values.

## Getting started

### Prerequisites

- [Bun](https://bun.sh) >= 1.2

### Local development

```bash
# Clone
git clone https://github.com/wefaber/lux.git
cd lux

# Install dependencies
bun install

# Start the development server
bun dev
```

The server runs at `http://localhost:5173`. MSW activates automatically in development mode, simulating the GraphQL backend with test data. Run `bun run setup` to regenerate the MSW service worker in `public/`.

### Test credentials

| Role | DNI | Password |
|------|-----|----------|
| Super Admin | `00000000` | `root2026` |
| Admin | `12345678` | `admin2026` |
| Technician | `34567890` | `tecnico2026` |
| Requester | `67890123` | `sol2026` |

### Production build

```bash
bun run build
bun run preview
```

The build generates static files in `dist/`, ready to be served by Nginx or any web server.

### Code quality

```bash
bun typecheck      # Type checking (tsc)
bun lint           # Linting (oxlint)
bun format         # Formatting (oxfmt)
```

## System modules

- **Dashboard** — Overall statistics, tickets by status, services by period
- **Inventory** — IT equipment (AIO, desktop, laptop, projectors, printers, switches, UPS, etc.) and internal components, with soft delete
- **Tickets** — Full lifecycle: creation → assignment → diagnosis → resolution. Multi-step wizard for guided creation. Unassigned ("OOL") queue
- **Loans** — Request, approval, and return of equipment, including components
- **Services** — Lab preparation, software installation, equipment setup
- **Administration** — User management, role configuration, activity log
- **Accessibility** — Light/dark theme, high contrast, adjustable font size, dyslexic font
