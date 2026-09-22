export type WebuiRoute = "login" | "onboarding" | "archon" | "404";

export function route(pathname: string): WebuiRoute {
  if (pathname === "/login") return "login";
  if (pathname === "/onboarding") return "onboarding";
  if (pathname === "/archon" || pathname === "/") return "archon";
  return "404";
}

