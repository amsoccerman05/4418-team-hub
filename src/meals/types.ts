/** Meal signup boundary: public DTOs contain coverage only, never contact details. */
export type MealCategory = 'main' | 'side' | 'drink' | 'supply' | 'other';
export type MealSlot = { id:string; label:string; category:MealCategory; unit:string; needed:number; confirmed:number; held:number; remaining:number };
export type PublicMeal = { id:string; title:string; service_at:string; timezone:string; expected_headcount:number; guidance:string; status:'open'|'closed'|'cancelled'; whole_meal:'available'|'held'|'confirmed'|'coordination_required'; slots:MealSlot[]; version:number };
export type ClaimInput = { meal_id:string; slot_id:string|null; whole_meal:boolean; quantity:number; name:string; email:string; idempotency_key:string; website?:string };
export type ClaimReceipt = { status:'pending_verification'; message:string; email_status:'queued'|'sent'|'unavailable'|'uncertain'|'retry'; hold_expires_at:string|null };
export type ManagedClaim = { id:string; meal_id:string; slot_id:string|null; whole_meal:boolean; quantity:number; name:string; email:string; status:'pending'|'confirmed'|'cancelled'|'expired'; email_status:'queued'|'sent'|'failed'|'uncertain'|'retry'; hold_expires_at:string|null; version:number };
export type PrivateClaim = { id:string; meal:PublicMeal; slot_id:string|null; whole_meal:boolean; quantity:number; name:string; status:ManagedClaim['status']; version:number; access_expires_at:string };
export type MealDraft = { id?:string; version?:number; title:string; service_at:string; timezone:string; expected_headcount:number; guidance:string; status:'open'|'closed'|'cancelled'; cancellation_reason?:string; acknowledge_cancellation?:boolean; slots:{id?:string;label:string;category:MealCategory;unit:string;needed:number}[] };
export type MealManagerSnapshot = { meals:PublicMeal[]; claims:ManagedClaim[]; mail_mode:'disabled'|'mock'|'live'; daily_budget_remaining:number|null };
export interface MealApi {
 list(signal?:AbortSignal):Promise<PublicMeal[]>;
 claim(input:ClaimInput):Promise<ClaimReceipt>;
 verify(token:string):Promise<{access_token:string;claim:PrivateClaim}>;
 inspect(token:string):Promise<PrivateClaim>;
 edit(token:string,input:{quantity:number;version:number}):Promise<PrivateClaim>;
 cancel(token:string,input:{version:number}):Promise<PrivateClaim>;
 manager(signal?:AbortSignal):Promise<MealManagerSnapshot>;
 saveMeal(input:MealDraft):Promise<PublicMeal>;
 cancelClaim(input:{id:string;version:number;reason:string}):Promise<void>;
}
