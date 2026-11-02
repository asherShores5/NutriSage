// The bottom tabs, in order. Each tab is its own component under views/<tab>/.
import type { ComponentType } from "react";
import { Goals } from "./views/goals/Goals";
import { Profile } from "./views/profile/Profile";
import { Today } from "./views/today/Today";
import { Trends } from "./views/trends/Trends";
import { Week } from "./views/week/Week";

export interface Tab {
  id: string;
  label: string;
  Component: ComponentType;
}

export const TABS: Tab[] = [
  { id: "today", label: "Today", Component: Today },
  { id: "week", label: "Week", Component: Week },
  { id: "trends", label: "Trends", Component: Trends },
  { id: "goals", label: "Goals", Component: Goals },
  { id: "profile", label: "Profile", Component: Profile },
];
