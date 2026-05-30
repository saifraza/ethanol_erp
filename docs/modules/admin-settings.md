# Admin & Settings Module

## Files
- **Backend**: `routes/auth.ts`, `routes/users.ts`, `routes/settings.ts`, `routes/documentTemplates.ts`
- **Frontend**: `pages/Login.tsx`, `pages/UsersPage.tsx`, `pages/SettingsPage.tsx`, `pages/DocumentTemplates.tsx`
- **Models**: User, Settings, DocumentTemplate, AuditLog

## Authentication
- JWT-based auth — token in Authorization header (`Bearer <token>`)
- Token expiry: 7 days (TODO: reduce to 1-4 hours + add refresh token)
- **AuthRequest** interface in `middleware/auth.ts` — ALWAYS use this for authenticated routes:
  ```typescript
  import { AuthRequest } from '../middleware/auth';
  router.get('/', asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?.id;  // Properly typed, no `as any`
  }));
  ```
- Roles: `admin`, `operator`, `lab` (stored in User.role)
- Module access: `User.allowedModules` is a comma-separated string checked by `authorize.ts`

## Settings Model
- Single-row configuration table with plant-specific parameters
- Key fields used across modules:
  - `yearStart`: Financial year start (typically April 1)
  - `pfGravityTarget`: Pre-fermenter target specific gravity (default 1.024)
  - `fermRetentionHours`: Target fermentation retention (default 8 hours)
  - `millingLossPercent`: Expected milling loss (default 2.5%)
  - `ddgsBaseProduction`: Base DDGS production value
- **Common bug**: Routes cast Settings `as any` because Prisma type doesn't include all dynamic fields
- **Fix**: Extend the Prisma Settings type or create a `SettingsWithDefaults` interface

## AuditLog
- Model exists in schema with fields: userId, action, entity, entityId, changes, ipAddress, createdAt
- **Currently UNUSED** — not referenced in any backend code
- **TODO**: Wire up via `shared/middleware/auditTrail.ts` on all mutation routes
- Indexes: [entity, entityId], [createdAt]

## Security Concerns
- Password minimum is 4 chars (`users.ts:157`) — increase to 8+ with complexity rules
- Default seed passwords: `admin123`, `operator123`, `lab@1234` — must be changed in production
- JWT secret has dev fallback — production throws if `JWT_SECRET` not set
- JWT tokens stored in `localStorage` — vulnerable to XSS (consider httpOnly cookies)
- CSP is disabled in Helmet: `helmet({ contentSecurityPolicy: false })` — enable with proper policy

## DocumentTemplate
- Stores PDF template configurations for invoices, challans, etc.
- Used by pdfGenerator.ts for generating standardized documents
