import {attendanceMeetingId} from './attendance/meeting-route';
import {isPersonalWorkRoute} from './planning/personal-task-route';
import {planningBoardRoute} from './planning/board-route';
import {fabricationRoute} from './fabrication/model';
import {goalRoute} from './planning/goals/model';
import {reviewRoute} from './planning/reviews/model';
import {parseOutreachRoute} from './outreach/model';

/** Retain only known in-app views, not arbitrary URLs, auth fragments or action payloads. */
export function hubAuthDestination(hash:string):string {
 if(/[\s\\\u0000-\u001f\u007f]/.test(hash))return '';
 return attendanceMeetingId(hash)||isPersonalWorkRoute(hash)||planningBoardRoute(hash)||fabricationRoute(hash).valid||goalRoute(hash).valid||reviewRoute(hash).valid||parseOutreachRoute(hash)||['#planning','#planning/plan','#planning/boards'].includes(hash)||/^#events(?:\/[a-z0-9-]+(?:\/preview)?)?$/.test(hash)?hash:'';
}
export const clearHubDestinationOnSignOut=(hash:string,explicit:boolean)=>explicit||!hubAuthDestination(hash);
