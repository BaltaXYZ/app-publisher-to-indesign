export type PubOleEntryType = "storage" | "stream" | "root" | "unknown";

export interface PubOleEntrySummary {
  path: string;
  name: string;
  type: PubOleEntryType;
  size: number;
}

export interface PubInspectionSummary {
  filePath: string;
  inspectedAt: string;
  container: "ole-cfb";
  entryCount: number;
  entries: PubOleEntrySummary[];
}

