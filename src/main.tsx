import { SuiteSwitcher } from './SuiteSwitcher';
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ChevronRight,
  ExternalLink,
  Boxes,
  Wrench,
  Receipt,
  Flag,
  MessageSquare,
  LayoutList,
  GraduationCap,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { systems, resources, suiteApps, type HubLink } from "./links";
import "./style.css";
import { TeamManagement } from "./team/TeamManagement";
import { AttendanceHub } from "./attendance/Attendance";
const branding = `${import.meta.env.BASE_URL}branding/`;
const icons: Record<string, LucideIcon> = {
  inventory: Boxes,
  pit: Wrench,
  finance: Receipt,
  first: Flag,
  slack: MessageSquare,
  monday: LayoutList,
  canvas: GraduationCap,
  website: Globe,
};
function SystemCard({ link }: { link: HubLink }) {
  const Icon = icons[link.id];
  return (
    <a className="system-card" href={link.url!}>
      <div className="system-top">
        <span className="system-icon">
          <Icon size={25} />
        </span>
        <span className="team-badge">4418 SYSTEM</span>
      </div>
      <h3>{link.name}</h3>
      <p>{link.description}</p>
      <span className="system-action">
        Open {link.name}
        <ArrowRight size={18} />
      </span>
    </a>
  );
}
function ResourceCard({ link }: { link: HubLink }) {
  const Icon = icons[link.id];
  const contents = (
    <>
      <span className="resource-icon">
        <Icon size={21} />
      </span>
      <div className="resource-copy">
        <h3>{link.name}</h3>
        <p>{link.description}</p>
        <span className="resource-meta">
          {link.url ? "Opens in a new tab" : "Link not configured"}
        </span>
      </div>
      {link.url ? (
        <ExternalLink className="external-icon" size={17} aria-hidden="true" />
      ) : (
        <span className="pending">Not set up</span>
      )}
    </>
  );
  return link.url ? (
    <a
      className="resource-card"
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {contents}
    </a>
  ) : (
    <div className="resource-card unconfigured">{contents}</div>
  );
}
function App() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const update = () => setRoute(location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const management = route === "#team-management";
  const workspace = route === "#attendance" || route.startsWith("#attendance/");
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-mark">
              <img
                src={`${branding}4418-impulse-emblem.png`}
                alt="Team 4418 IMPULSE rocket logo"
              />
            </span>
            <div>
              4418<span>TEAM HUB</span>
            </div>
          </div>
          <SuiteSwitcher current="Team Hub / Home" items={suiteApps} />
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={14} />
            <strong>{management ? "Team Management" : workspace ? "Attendance" : "Team Hub"}</strong>
          </div>
          <span className="header-team">
            FRC Team 4418 <span>IMPULSE</span>
          </span>
        </div>
      </header>
      <main id="main">
        {!workspace && !management && (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">TEAM 4418 / IMPULSE</span>
                <h1>Your team. Connected.</h1>
                <p>
                  One place for the tools and resources that keep us moving.
                </p>
              </div>
              <span className="wordmark">
                <img
                  src={`${branding}4418-impulse-wordmark.png`}
                  alt="IMPULSE — FRC Team 4418"
                />
              </span>
            </div>
            <section aria-labelledby="systems-heading">
              <div className="section-heading">
                <div>
                  <h2 id="systems-heading">4418 Systems</h2>
                  <p>Built for our team. Ready when you need them.</p>
                </div>
                <span className="section-label">TEAM WORKSPACES</span>
              </div>
              <div className="systems-grid">
                {systems.map((link) => (
                  <SystemCard key={link.id} link={link} />
                ))}
              </div>
            </section>
          </>
        )}
        {!management && <AttendanceHub
          workspace={workspace}
          tab={route.split("/")[1] || "calendar"}
        />}
        {!workspace && <TeamManagement workspace={management} />}
        {!workspace && !management && (
          <>
            <section className="resources" aria-labelledby="resources-heading">
              <div className="section-heading">
                <div>
                  <h2 id="resources-heading">Team Resources</h2>
                  <p>The other places we work, learn, and connect.</p>
                </div>
                <span className="external-label">
                  <ExternalLink size={14} />
                  External links
                </span>
              </div>
              <div className="resources-grid">
                {resources.map((link) => (
                  <ResourceCard key={link.id} link={link} />
                ))}
              </div>
              {resources.some((link) => !link.url) && (
                <p className="configuration-note">
                  Some team links aren’t set up yet. Check with a mentor for
                  access.
                </p>
              )}
            </section>
          </>
        )}
        <footer>
          <span>
            4418 IMPULSE <span className="footer-divider">/</span> One team.
            Connected.
          </span>
          <span>Use your usual account in each app.</span>
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
