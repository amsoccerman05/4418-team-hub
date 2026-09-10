/** All launcher destinations live here. Replace null with the team's exact HTTPS
 * URL when confirmed. Null means deliberately unconfigured: no guessed link.
 * This is public browser configuration; never put secrets or invite tokens here.
 * Internal systems open in the same tab. Team Resources open in a new tab.
 */
export type HubLink = {
  id: string;
  name: string;
  description: string;
  url: string | null;
};
export const systems: HubLink[] = [
  {
    id: "inventory",
    name: "Inventory",
    description: "Find parts, tools, and supplies. Keep the team organized.",
    url: "https://inventory.frc4418.org",
  },
  {
    id: "pit",
    name: "Pit Operations",
    description:
      "Track robot issues and batteries. Keep the robot match-ready.",
    url: "https://pit.frc4418.org",
  },
];
export const resources: HubLink[] = [
  {
    id: "first",
    name: "FIRST Dashboard",
    description: "Your FIRST account and team dashboard.",
    url: null,
  }, // TODO: exact team-approved FIRST dashboard URL
  {
    id: "slack",
    name: "Slack",
    description: "Stay connected with the team.",
    url: null,
  }, // TODO: team Slack workspace URL
  {
    id: "monday",
    name: "Monday",
    description: "Open the team’s Monday workspace.",
    url: null,
  }, // TODO: team Monday workspace URL
  {
    id: "canvas",
    name: "Canvas",
    description: "Access your learning resources.",
    url: null,
  }, // TODO: school/team Canvas URL
  {
    id: "website",
    name: "Team Website",
    description: "Meet IMPULSE and see what we’re building.",
    url: "https://www.frc4418.org",
  },
];
