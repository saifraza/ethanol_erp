export interface User {
  id: string; email: string; name: string; role: 'OPERATOR' | 'SUPERVISOR' | 'ADMIN' | 'FIELD'; allowedModules?: string | null; isActive?: boolean;
}
