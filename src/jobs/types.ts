export type JobMessage =
  | { kind: "refresh_source"; sourceId: number; jobKey: string }
  | { kind: "send_notification"; notificationId: number; jobKey: string }
  | { kind: "cleanup_logs"; cursor?: string; jobKey: string };
