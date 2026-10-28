import {test,expect} from '@playwright/test';
import {hubAuthDestination,clearHubDestinationOnSignOut} from '../src/auth-destination';
import {planningBoardRoute} from '../src/planning/board-route';
const id='a1000000-0000-4000-8000-000000000001';
const allowed=['#planning','#planning/plan','#planning/boards',`#planning/boards/${id}`,`#planning/boards/${id}/assembly`,`#planning/boards/${id}/decisions`,'#fabrication',`#fabrication/projects/${id}`,`#attendance/meeting/${id}`,'#planning/my-work',`#planning/my-work/${id}`,'#planning/goals',`#planning/goals/${id}`,'#planning/reviews',`#planning/reviews/${id}`,`#planning/reviews/${id}/project/${id}`,'#outreach',`#outreach/${id}`,'#events','#events/example/preview'];
test('supported read-only destinations survive sign-in and automatic session interruption',()=>{
 for(const hash of allowed){expect(hubAuthDestination(hash)).toBe(hash);expect(clearHubDestinationOnSignOut(hash,false)).toBe(false);}
 expect(planningBoardRoute(`#planning/boards/${id.toUpperCase()}/assembly`)).toEqual({id,view:'assembly'});
});
test('explicit logout always clears destinations, including supported ones',()=>{
 for(const hash of [...allowed,'','#access_token=secret&type=recovery'])expect(clearHubDestinationOnSignOut(hash,true)).toBe(true);
});
test('malformed IDs, extra segments, auth material and external URLs fail closed',()=>{
 for(const hash of ['',`#planning/boards/${id}/save`,`#planning/boards/${id}/assembly/extra`,'#planning/boards/not-a-uuid',`#fabrication/projects/${id}?action=claim`,`#fabrication/projects/${id}/extra`,`#planning/my-work/${id}#access_token=secret`,'https://evil.invalid/','//evil.invalid/','#https://evil.invalid/','#access_token=secret&type=recovery','#planning/boards/%2F%2Fevil.invalid',`#planning/boards/${id}\n`,`#planning/boards/${id}\\extra`]){expect(hubAuthDestination(hash)).toBe('');expect(clearHubDestinationOnSignOut(hash,false)).toBe(true);}
});
