export type SessionView = { role:'TEACHER'|'STUDENT'; expiresAt:number; createdAt:number;
  activityId?:string; groupId?:string; participantId?:string; nickname?:string };
export type SessionGrant = { token:string; generation:number; session:SessionView };
export type TabProof = { secret:string; instanceId:string; generation:number; token?:string };
export const sessionKeys={credential:'crs.session.v1',nickname:'crs.nickname.v1',draftPrefix:'crs.draft.'} as const;
export const tabNamePrefix='crs-tab-v1:';
