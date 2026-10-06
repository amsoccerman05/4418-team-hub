/** Each request belongs to one actor and one uninterrupted view/editor lifetime. */
export type OutreachScope = {actorId:string; signal:AbortSignal; isCurrent:()=>boolean};
export class OutreachError extends Error {
  constructor(public kind:'abandoned'|'denied'|'unavailable'|'invalid'|'conflict'|'rejected'|'uncertain', message:string) {super(message); this.name='OutreachError';}
}
export function assertCurrent(scope:OutreachScope) {
  if(scope.signal.aborted || !scope.isCurrent()) throw new OutreachError('abandoned','This view has changed.');
}
export function requestScope(actorId:string, parentSignal:AbortSignal, isCurrent:()=>boolean) {
  const controller=new AbortController();
  return {controller, scope:{actorId,signal:AbortSignal.any([parentSignal,controller.signal]),isCurrent}};
}
export function errorMessage(error:unknown) {
  return error instanceof OutreachError ? error.message : 'Unable to connect. Reload the workspace to try again.';
}
