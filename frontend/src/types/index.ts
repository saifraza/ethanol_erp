export interface User {
  id: string; email: string; name: string; role: 'OPERATOR' | 'SUPERVISOR' | 'ADMIN' | 'SUPER_ADMIN' | 'FIELD'; allowedModules?: string | null; isActive?: boolean;
}
