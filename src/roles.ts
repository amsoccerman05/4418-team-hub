export const ACCOUNT_ROLES=['readonly','student','lead','admin_lead','mentor'] as const;
export const roleLabel=(role:string)=>({readonly:'Read only',student:'Student',lead:'Lead',admin_lead:'Admin Lead',mentor:'Mentor',admin:'Retired Owner Admin'}[role]||role);
export const inviteRoles=(actor:string)=>actor==='admin_lead'?['student']:actor==='mentor'?['student','lead','admin_lead','mentor','readonly']:[];
