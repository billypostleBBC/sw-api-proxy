export type Scope = "admin" | "user";

export type AuthContext = {
  mode: "tool" | "ticket";
  toolId: number;
  toolSlug: string;
  projectId: number;
  projectSlug: string;
  projectStatus: string;
  rpmCap: number;
  dailyTokenCap: number;
};
