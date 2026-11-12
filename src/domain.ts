import { idealObservation } from "./ideal-profile.ts";
import { withProfileProof } from "./profile-proof.ts";
import type { EmailVerificationFields } from "./email-verification.ts";
export type ScoutingProfile = {
  id: string;
  name: string;
  audience: string;
  location: string;
  niche: string;
  sub_niche: string;
  usp: string;
  offer: string;
  demo_video_url?: string;
  work_sample_url?: string;
  sender_name?: string;
  signature_text?: string;
  signature_image_url?: string;
};
export type LeadList = { id: string; name: string; created_at: string };
export type Lead = EmailVerificationFields & import("./prospect-pool.ts").ProspectDetails & {
  id: string;
  list_id: string;
  company: string;
  contact_name: string;
  category: string;
  location: string;
  email: string;
  phone: string;
  website: string;
  linkedin: string;
  source_url: string;
  score: number;
  status: string;
  ideal_qualification?: import("./ideal-profile.ts").IdealQualification;
};
export type Message = {
  step: number;
  subject: string;
  body: string;
  delay_hours: number;
};
export type Campaign = import("./email-signature.ts").EmailSignature & {
  id: string;
  name: string;
  list_id: string;
  profile_id: string;
  mailbox_id: string;
  status: "draft" | "scheduled" | "running" | "paused" | "completed";
  start_at: string;
  messages: Message[];
  approved: boolean;
  sent: number;
  analytics?: import("./campaign-analytics.ts").CampaignAnalytics;
};
export type Mailbox = {
  id: string;
  email: string;
  provider: string;
  status: string;
};
export type Workspace = {
  profiles: ScoutingProfile[];
  lists: LeadList[];
  leads: Lead[];
  campaigns: Campaign[];
  mailboxes: Mailbox[];
};
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
export { booleanQuery } from "./scout-query.ts";
export function renderMessage(text: string, lead: Partial<Lead>) {
  return text.replace(
    /\{\{(company|contact_name|location|category|ideal_observation)\}\}/g,
    (_, k) => k === "ideal_observation" ? idealObservation(lead.ideal_qualification) :
      String(lead[k as keyof Lead] || (k === "contact_name" ? "there" : "")),
  );
}
export function validateMessages(messages: Message[]) {
  return (
    messages.length === 4 &&
    messages.every(
      (m, i) =>
        m.step === i &&
        !!m.body.trim() &&
        !!m.subject.trim() &&
        Number.isInteger(m.delay_hours) &&
        (i === 0
          ? m.delay_hours === 0
          : m.delay_hours >= 1 && m.delay_hours <= 720),
    )
  );
}
export function draftMessages(p: ScoutingProfile): Message[] {
  const messages: Message[] = [
    {
      step: 0,
      delay_hours: 0,
      subject: `An idea for {{company}}`,
      body: `Hi {{contact_name}},\n\nI came across {{company}} while looking at ${p.audience} in {{location}}. ${p.usp}\n\n${p.offer}\n\nWould it be useful if I shared a few ideas for {{company}}?`,
    },
    {
      step: 1,
      delay_hours: 48,
      subject: `A quick thought for {{company}}`,
      body: `Hi {{contact_name}},\n\nFollowing up on my note about ${p.niche.toLowerCase()}. One place we could start is ${p.sub_niche.toLowerCase()}.\n\n${p.offer}\n\nIs this a priority for {{company}} right now?`,
    },
    {
      step: 2,
      delay_hours: 72,
      subject: `Worth exploring?`,
      body: `Hi {{contact_name}},\n\nI know things get busy. Our approach is simple: ${p.usp}\n\nIf that fits what {{company}} needs, I’d be happy to share a short, practical next step.`,
    },
    {
      step: 3,
      delay_hours: 120,
      subject: `Closing the loop`,
      body: `Hi {{contact_name}},\n\nI’ll close the loop here. If ${p.niche.toLowerCase()} becomes a priority for {{company}}, I’d be glad to help.\n\nIf you’d rather I didn’t contact you again, just reply and let me know.`,
    },
  ];
  return withProfileProof(messages, p);
}
export function emptyWorkspace(): Workspace {
  return { profiles: [], lists: [], leads: [], campaigns: [], mailboxes: [] };
}
export function demoWorkspace(): Workspace {
  const profile: ScoutingProfile = {
    id: uid(),
    name: "Growth-minded hospitality",
    audience: "Boutique hotels",
    location: "Lagos, Nigeria",
    niche: "Digital marketing",
    sub_niche: "Direct booking optimization",
    usp: "We help independent hotels turn website visits into direct bookings with a conversion-first growth strategy.",
    offer:
      "A complimentary 15-minute booking funnel review with 3 actionable recommendations.",
  };
  const list = {
    id: uid(),
    name: "Lagos · Boutique hospitality",
    created_at: new Date().toISOString(),
  };
  const names = [
    "The Palm House",
    "Lagos Continental",
    "Maison Fahrenheit",
    "The George",
    "Nordic Hotel",
    "Villa Monticello",
  ];
  const leads = names.map((company, i) => ({
    id: uid(),
    list_id: list.id,
    company,
    contact_name: [
      "Ada Okafor",
      "Tunde Bello",
      "Amaka Eze",
      "Femi Adeyemi",
      "Zainab Musa",
      "Kofi Mensah",
    ][i],
    category: "Boutique hotel",
    location: [
      "Victoria Island, Lagos",
      "Victoria Island, Lagos",
      "Victoria Island, Lagos",
      "Ikoyi, Lagos",
      "Victoria Island, Lagos",
      "Ikoyi, Lagos",
    ][i],
    email: `hello@sample-${i + 1}.example`,
    phone: "",
    website: "https://example.com",
    linkedin: "",
    source_url: "",
    score: 98 - i * 3,
    status: "new",
  }));
  return {
    profiles: [profile],
    lists: [list],
    leads,
    campaigns: [
      {
        id: uid(),
        name: "Lagos hospitality · Direct bookings",
        list_id: list.id,
        profile_id: profile.id,
        mailbox_id: "",
        status: "draft",
        start_at: "",
        messages: draftMessages(profile),
        approved: false,
        sent: 0,
      },
    ],
    mailboxes: [],
  };
}
