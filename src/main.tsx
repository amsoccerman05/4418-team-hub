import {NotificationProvider,NotificationBell,Notifications} from './notifications/Notifications';
import { HubNav } from './HubNav';
import { SuiteHeader } from './SuiteHeader';
import {useHubAuth} from './HubAuth';
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { My4418 } from "./dashboard/Dashboard";
import { TeamManagement } from "./team/TeamManagement";
import { AttendanceHub } from "./attendance/Attendance";
import { PlanningNav } from "./planning/PlanningNav";
import { Planning } from "./planning/Planning";
import {EventOverview} from "./events/EventOverview";
import {Outreach} from "./outreach/Outreach";
function App() {
  const auth=useHubAuth();
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const update = () => setRoute(location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const events = route === "#events" || route.startsWith("#events/");
  const planning = route === '#planning' || route.startsWith('#planning/');
  const notifications=route==='#notifications'||route.startsWith('#notifications/');
  const management = route === "#team-management";
  const outreach = route === '#outreach' || route.startsWith('#outreach/');
  const announcements = route === "#announcements";
  const workspace = route === "#attendance" || route.startsWith("#attendance/");
  if(!auth.signed)return auth.panel;
  return (
    <NotificationProvider key={auth.userId}>
      <a className="skip-link" href="#main" onClick={event => {event.preventDefault();document.getElementById("main")?.focus();}}>
        Skip to content
      </a>
      <SuiteHeader app={planning?'Planning':workspace?'Attendance':'Team Hub'} context={events?'Events':notifications?'Notifications':planning?({'plan':'Season Plan','boards':'Boards','my-work':'My Work'}[route.split('/')[1]]||'Dashboard'):management?'Team Management':outreach?'Sponsor & Outreach':announcements?'Announcements':workspace?'Attendance':'My 4418'} notifications={!planning?<NotificationBell/>:undefined} name={auth.name} onSignOut={auth.signOut} busy={auth.busy}/>

      <div className={`hub-shell${planning?' planning-shell':''}`}>{planning?<PlanningNav route={route}/>:<HubNav route={route}/>}<main id="main" tabIndex={-1}>
        {auth.error&&<p role="alert">{auth.error}</p>}
        {auth.signed && !workspace && !management && !outreach && !planning && !notifications && !events && <My4418 management={announcements} />}
        {events&&<EventOverview route={route}/>}
        {notifications&&<Notifications/>}
        {auth.signed && workspace && <AttendanceHub
          workspace={workspace}
          tab={route.split("/")[1] || ""}
        />}
        {auth.signed && planning && <Planning route={route}/> }
        {auth.signed && management && <TeamManagement workspace /> }
        {auth.signed && outreach && <Outreach actorId={auth.userId||''} route={route}/> }

        <footer>
          <span>
            4418 IMPULSE <span className="footer-divider">/</span> One team.
            Connected.
          </span>
          <span>Your team, in one place.</span>
        </footer>
      </main></div>
    </NotificationProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import "./design-system.css";
