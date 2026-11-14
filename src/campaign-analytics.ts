export type CampaignAnalytics = {
  id: string;
  status: string;
  daily_send_limit?: number | null;
  daily_sent?: number;
  daily_reserved?: number;
  daily_remaining?: number | null;
  send_timezone?: string;
  daily_reset_at?: string;
  daily_resume_at?: string | null;
  daily_limit_reached?: boolean;
  total_recipients: number;
  valid_recipients: number;
  total_sent: number;
  total_fails: number;
  bounce: number;
  read: number;
  response: number;
  pending: number;
  processing: number;
  uncertain: number;
  suppressed: number;
  next_send_at: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  tracking_ready: boolean;
  errors: { status: string; last_error: string }[];
};
export function campaignMetrics(a: CampaignAnalytics) {
  return [
    { label: "Total recipients", value: a.total_recipients },
    { label: "Valid recipients · email", value: a.valid_recipients },
    { label: "Emails sent", value: a.total_sent },
    { label: "Failed attempts", value: a.total_fails },
    { label: "Bounced", value: a.bounce },
    { label: "Read", value: a.tracking_ready ? a.read : null },
    { label: "Responses", value: a.tracking_ready ? a.response : null },
  ];
}
