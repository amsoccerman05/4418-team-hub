import { SuiteHeader } from './SuiteHeader';
import {useHubAuth} from './HubAuth';
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { My4418 } from "./dashboard/Dashboard";
import { TeamManagement } from "./team/TeamManagement";
import { AttendanceHub } from "./attendance/Attendance";
function App() {
  const auth=useHubAuth();
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const update = () => setRoute(location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const management = route === "#team-management";
  const announcements = route === "#announcements";
  const workspace = route === "#attendance" || route.startsWith("#attendance/");
  if(!auth.signed)return auth.panel;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SuiteHeader app="Team Hub" context={management?'Team Management':announcements?'Announcements':workspace?'Attendance':'My 4418'} name={auth.name} onSignOut={auth.signOut} busy={auth.busy}/>

      <main id="main">
        {auth.error&&<p role="alert">{auth.error}</p>}
        {auth.signed && !workspace && !management && <My4418 management={announcements} />}
        {auth.signed && workspace && <AttendanceHub
          workspace={workspace}
          tab={route.split("/")[1] || "calendar"}
        />}
        {auth.signed && management && <TeamManagement workspace /> }

        <footer>
          <span>
            4418 IMPULSE <span className="footer-divider">/</span> One team.
            Connected.
          </span>
          <span>Your team, in one place.</span>
        </footer>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
