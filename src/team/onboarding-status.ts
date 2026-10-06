export type OnboardingMember={id:string;display_name:string;email?:string;active:boolean;member_status:string|null};
export type OnboardingInvitation={id:string;email:string;display_name:string;status:string;review_reason?:string;created_at:string;user_id:string|null};
export function invitationSetup(invitation:OnboardingInvitation):{label:string;description:string;tone:'ready'|'pending'|'review'}{
 switch(invitation.status){
  case 'account_active':return {label:'Account active',description:'Active account, verified email, and a sign-in confirmed. Password setup is not tracked here.',tone:'ready'};
  case 'pending':return {label:'Awaiting account setup',description:'The service accepted the invitation, but the member has not signed in yet. Inbox delivery and password setup are not confirmed.',tone:'pending'};
  case 'processing':return {label:'Invitation processing',description:'The service is still processing this invitation. Refresh status; do not resend.',tone:'pending'};
  case 'accepted':return {label:'Sign-in recorded',description:'A legacy record shows a sign-in, which does not confirm password setup. Refresh for current account status.',tone:'pending'};
  default:return {label:'Needs review',description:invitation.review_reason==='identity_unmatched'?'An account exists, but the invitation is not safely linked to it.':invitation.review_reason==='account_not_ready'?'The linked account is not confirmed ready. Review its access and setup status.':'The invitation or account setup could not be confirmed. Check Activity before another action.',tone:'review'};
 }
}
export function attendanceRegistration(member:OnboardingMember|undefined):{label:string;description:string}{
 if(!member)return {label:'Unavailable',description:'A verified member link is needed. No registration is inferred from an email address.'};
 const labels:Record<string,string>={registered:'Registered',prospective:'Prospective',inactive:'Inactive'};
 return {label:member.member_status===null?'Not tracked':labels[member.member_status]||'Unavailable',description:member.active?'Team attendance registration only.':'The account is inactive; attendance registration is separate.'};
}
export function linkedInvitationMember(invitation:OnboardingInvitation,members:readonly OnboardingMember[]):OnboardingMember|undefined{
 return invitation.user_id?members.find(member=>member.id===invitation.user_id):undefined;
}

/** Only server-confirmed account readiness moves an invitation out of the open queue. */
export function invitationDirectory(invitations:readonly OnboardingInvitation[]):{open:OnboardingInvitation[];history:OnboardingInvitation[]}{
 const open:OnboardingInvitation[]=[],history:OnboardingInvitation[]=[];
 for(const invitation of invitations)(invitation.status==='account_active'?history:open).push(invitation);
 return {open,history};
}
