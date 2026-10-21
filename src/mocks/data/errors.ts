import type { ErrorReport } from "@/lib/types";

// Errores de ejemplo para que el panel de issues tenga contenido en desarrollo.
// Los reales llegan por POST /api/v1/errors (handler de abajo) y se agrupan por
// `fingerprint`.
export const mockErrorReports: ErrorReport[] = [
  {
    id: "err-001",
    fingerprint: "3f9a1c02d4e5b670",
    message: "Cannot read properties of undefined (reading 'map')",
    stack:
      "TypeError: Cannot read properties of undefined (reading 'map')\n    at InventoryPage (src/features/inventory/InventoryPage.tsx:84:21)\n    at renderWithHooks (react-dom.development.js:15486:18)",
    route: "/dashboard/inventory",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    role: "admin",
    firstSeen: "2026-10-18T13:22:10.000Z",
    lastSeen: "2026-10-20T09:14:02.000Z",
    occurrences: 7,
    status: "new",
    githubIssueUrl: null,
    createdAt: "2026-10-18T13:22:10.000Z",
    updatedAt: "2026-10-20T09:14:02.000Z",
  },
  {
    id: "err-002",
    fingerprint: "8b1e44a90c2d7f31",
    message: "ChunkLoadError: Loading chunk 42 failed.",
    stack:
      "Error: Loading chunk 42 failed.\n    at __webpack_require__.f.j (bundle.js:1204:29)\n    at src/features/tickets/TicketDetail.tsx:14:1",
    route: "/dashboard/tickets/tkt-004",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    role: "tecnico",
    firstSeen: "2026-10-19T18:02:41.000Z",
    lastSeen: "2026-10-19T18:02:41.000Z",
    occurrences: 1,
    status: "triaged",
    githubIssueUrl: null,
    createdAt: "2026-10-19T18:02:41.000Z",
    updatedAt: "2026-10-19T18:05:00.000Z",
  },
];
