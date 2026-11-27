export type ExportMode='ANSWERS'|'COLUMNS'|'INLINE';
export type ExportState='PREPARING'|'WRITING'|'COMPLETED'|'FAILED'|'UNCONFIRMED';
export type ExportView={id:string;activityId:string;mode:ExportMode;state:ExportState;message:string;updatedAt:number;requiresCredentialConfirmation?:boolean;accountEmail?:string|null};
