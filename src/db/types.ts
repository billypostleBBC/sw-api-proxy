export type Scope = "admin" | "user";

export type AuthContext = {
  mode: "tool";
  toolId: number;
  toolSlug: string;
  toolStatus: string;
  projectId: number;
  projectSlug: string;
  projectStatus: string;
  rpmCap: number;
  dailyTokenCap: number;
};
