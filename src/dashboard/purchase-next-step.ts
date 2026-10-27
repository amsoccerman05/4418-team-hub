// Home receives only status and approval count, not the individual slots or
// requester capabilities. Keep this summary honest; Finance resolves the exact
// reviewer and available actions from fresh, authorized data.
export function purchaseNextStep(status:string,approvals:number):string {
 switch(status){
  case 'draft':return 'Complete your request, then submit it for approval.';
  case 'changes_requested':return 'Review the requested changes, update your request, and resubmit.';
  case 'awaiting_approval':return approvals===0
   ? 'Waiting for Lead Coach and Finance Lead approval. Nothing to do right now.'
   : approvals===1 ? 'Waiting for the remaining approver. Nothing to do right now.'
   : 'Open Finance to check the latest approval status.';
  case 'approved':return 'Next: school submission. Open Finance for the available next step.';
  case 'submitted_to_school':return 'Waiting for delivery. Tell the school submitter when the full order arrives.';
  case 'received':return 'Received — no further action needed.';
  case 'cancelled':return 'Cancelled — no further action needed.';
  default:return 'Open Finance to check the current status and next step.';
 }
}
