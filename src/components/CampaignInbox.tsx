import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Inbox,
  RefreshCw,
  Search,
  Sparkles,
  Send,
  ChevronLeft,
  MessageSquare,
  CheckCheck,
} from "lucide-react-native";
import { api } from "../supabase";
import { uid, type Campaign, type Mailbox } from "../domain";
import {
  inboxUnread,
  inboxNeedsReply,
  type Conversation,
  type InboxMessage,
  type ReplySend,
} from "../campaign-inbox";
type Theme = {
  bg: string;
  panel: string;
  raised: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  soft: string;
  danger: string;
};
type Props = {
  t: Theme;
  demo: boolean;
  ownerId: string;
  campaigns: Campaign[];
  mailboxes: Mailbox[];
  initialCampaignId: string;
  onAnalyticsRefresh: () => void;
};
type Summary = {
  conversations: number;
  responders: number;
  responses: number;
  unread: number;
  awaiting: number;
};
const zero: Summary = {
  conversations: 0,
  responders: 0,
  responses: 0,
  unread: 0,
  awaiting: 0,
};
const when = (v: string) =>
  new Date(v).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
function sample(campaignId: string) {
  const at = (minutes: number) =>
    new Date(Date.now() - minutes * 60000).toISOString();
  const c: Conversation = {
    id: "demo-conversation",
    owner_id: "demo",
    campaign_id: campaignId,
    mailbox_id: "demo-mailbox",
    thread_id: "demo-thread",
    contact_name: "Ada Okafor",
    contact_email: "ada@palm-house.example",
    company: "The Palm House",
    last_message_at: at(12),
    last_preview: "Could you share what the booking funnel review would cover?",
    last_reply_at: at(12),
    last_outbound_at: at(120),
    last_read_at: null,
    reply_count: 1,
    last_sender_name: "Ada Okafor",
    last_sender_email: "ada@palm-house.example",
    synced_at: at(1),
    sync_error: null,
    sync_cursor: null,
  };
  const messages: InboxMessage[] = [
    {
      id: "demo-out",
      conversation_id: c.id,
      provider_message_id: "demo-out",
      direction: "outbound",
      from_email: "you@agency.example",
      from_name: "Your agency",
      to_emails: [c.contact_email],
      subject: "An idea for The Palm House",
      body_text:
        "Hi Ada,\n\nWe help independent hotels turn website visits into direct bookings. Would a complimentary booking funnel review be useful for The Palm House?",
      body_truncated: false,
      received_at: at(120),
      reply_reference: "demo-out",
    },
    {
      id: "demo-in",
      conversation_id: c.id,
      provider_message_id: "demo-in",
      direction: "inbound",
      from_email: c.contact_email,
      from_name: c.contact_name,
      to_emails: ["you@agency.example"],
      subject: "Re: An idea for The Palm House",
      body_text:
        "Hi, thanks for reaching out.\n\nCould you share what the booking funnel review would cover? We’re interested in improving our direct bookings.\n\nBest,\nAda",
      body_truncated: false,
      received_at: at(12),
      reply_reference: "demo-in",
    },
  ];
  return { c, messages };
}
export function CampaignInbox({
  t,
  demo,
  ownerId,
  campaigns,
  mailboxes,
  initialCampaignId,
  onAnalyticsRefresh,
}: Props) {
  const narrow = useWindowDimensions().width < 1100;
  const [demoData] = useState(() => sample(campaigns[0]?.id || "demo"));
  const [campaignId, setCampaignId] = useState(initialCampaignId);
  const [filter, setFilter] = useState("responses"),
    [search, setSearch] = useState("");
  const [rows, setRows] = useState<Conversation[]>([]),
    [summary, setSummary] = useState<Summary>(zero);
  const [nextOffset, setNextOffset] = useState<number | null>(null),
    [selectedId, setSelectedId] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(null),
    [messages, setMessages] = useState<InboxMessage[]>([]);
  const [before, setBefore] = useState<{ at: string; id: string } | null>(null);
  const [parentId, setParentId] = useState(""),
    [draft, setDraft] = useState(""),
    [notes, setNotes] = useState("");
  const [delivery, setDelivery] = useState<ReplySend | null>(null);
  const [loading, setLoading] = useState(false),
    [opening, setOpening] = useState(false),
    [syncing, setSyncing] = useState(false),
    [drafting, setDrafting] = useState(false),
    [sending, setSending] = useState(false),
    [older, setOlder] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const active = useRef(""),
    parent = useRef(""),
    revision = useRef(0),
    listVersion = useRef(0),
    request = useRef(uid()),
    marked = useRef<Record<string, string>>({});
  const mounted = useRef(true),
    syncLock = useRef(false);
  const listScope = useRef("");
  listScope.current = JSON.stringify([campaignId, filter, search]);
  const draftKey = (id: string) => `aisas.inbox.draft.v1:${ownerId}:${id}`;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listVersion.current++;
    };
  }, []);
  useEffect(() => {
    setCampaignId(initialCampaignId);
  }, [initialCampaignId]);
  const pickParent = (id: string) => {
    parent.current = id;
    setParentId(id);
    request.current = uid();
  };
  function editDraft(value: string) {
    revision.current++;
    request.current = uid();
    setDraft(value);
    void AsyncStorage.setItem(
      draftKey(active.current),
      JSON.stringify({
        body: value,
        request_id: request.current,
        parent_id: parent.current,
      }),
    ).catch(() => {});
  }
  async function list(offset = 0) {
    const scope = JSON.stringify([campaignId, filter, search]);
    if (scope !== listScope.current) return;
    const version = ++listVersion.current;
    if (!offset) setLoading(true);
    try {
      if (demo) {
        const c =
          conversation?.id === demoData.c.id ? conversation : demoData.c;
        const match =
          (!campaignId || campaignId === c.campaign_id) &&
          (!search.trim() ||
            [c.company, c.contact_email, c.contact_name, c.last_preview]
              .join(" ")
              .toLowerCase()
              .includes(search.trim().toLowerCase()));
        setRows(match ? [c] : []);
        setSummary({
          conversations: 1,
          responders: 1,
          responses: c.reply_count,
          unread: inboxUnread(c) ? 1 : 0,
          awaiting: inboxNeedsReply(c) ? 1 : 0,
        });
        setNextOffset(null);
        return;
      }
      const r = await api("inbox-list", {
        campaign_id: campaignId || undefined,
        filter,
        search,
        offset,
      });
      if (
        !mounted.current ||
        version !== listVersion.current ||
        scope !== listScope.current
      )
        return;
      setRows((old) =>
        offset
          ? [
              ...old,
              ...r.conversations.filter(
                (c: Conversation) => !old.some((x) => x.id === c.id),
              ),
            ]
          : r.conversations,
      );
      setSummary(r.summary);
      setNextOffset(r.next_offset);
    } catch (e) {
      if (mounted.current && version === listVersion.current)
        setError((e as Error).message);
    } finally {
      if (mounted.current && version === listVersion.current) setLoading(false);
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => void list(), 250);
    return () => {
      clearTimeout(timer);
      listVersion.current++;
    };
  }, [campaignId, filter, search, demo]);
  useEffect(() => {
    if (demo) void list();
  }, [conversation?.last_message_at, conversation?.last_read_at]);
  useEffect(() => {
    if (demo) return;
    const timer = setInterval(() => {
      void list();
      if (active.current) void open(active.current, false);
    }, 30000);
    return () => clearInterval(timer);
  }, [campaignId, filter, search, demo]);
  async function sync() {
    if (demo) {
      setNotice(
        "This is a sample conversation. Sign in to sync your real campaign replies.",
      );
      return;
    }
    if (syncLock.current) return;
    syncLock.current = true;
    setSyncing(true);
    setError("");
    try {
      const result = await api("inbox-sync", {
        campaign_id: campaignId || undefined,
      });
      await list();
      if (active.current) await open(active.current, false);
      onAnalyticsRefresh();
      setNotice(
        result.errors
          ? `${result.synced} conversations synced; ${result.errors} could not be refreshed. Open a conversation for details.`
          : `${result.synced} conversations synced. Remaining conversations continue syncing in the background.`,
      );
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      syncLock.current = false;
      if (mounted.current) setSyncing(false);
    }
  }
  useEffect(() => {
    if (!demo) void sync();
  }, [campaignId, demo]);
  async function open(id: string, live = true) {
    const changed = active.current !== id;
    if (changed) {
      active.current = id;
      setSelectedId(id);
      setMessages([]);
      setConversation(rows.find((c) => c.id === id) || null);
      setDraft("");
      setNotes("");
      setDelivery(null);
      setBefore(null);
      pickParent("");
      revision.current++;
      setError("");
      setNotice("");
      const rev = revision.current;
      void AsyncStorage.getItem(draftKey(id)).then((saved) => {
        if (active.current !== id || rev !== revision.current || !saved) return;
        try {
          const value = JSON.parse(saved);
          if (typeof value.body === "string") {
            setDraft(value.body);
            request.current = value.request_id || uid();
            parent.current = value.parent_id || "";
            setParentId(parent.current);
          }
        } catch {}
      });
    }
    if (changed || live) setOpening(true);
    try {
      const r = demo
        ? {
            conversation: conversation?.id === id ? conversation : demoData.c,
            messages:
              messages.length && !changed ? messages : demoData.messages,
            next_before: null,
            request: null,
          }
        : await api("inbox-open", { conversation_id: id, sync: live });
      if (!mounted.current || active.current !== id) return;
      setConversation(r.conversation);
      setRows((old) => old.map((c) => (c.id === id ? r.conversation : c)));
      setMessages((old) => {
        const merged = new Map<string, InboxMessage>(
          (changed ? [] : old).map((m) => [m.id, m]),
        );
        for (const m of r.messages) merged.set(m.id, m);
        return [...merged.values()].sort(
          (a, b) =>
            a.received_at.localeCompare(b.received_at) ||
            a.id.localeCompare(b.id),
        );
      });
      if (changed) setBefore(r.next_before);
      setDelivery(r.request);
      if (r.request?.state === "sent" && r.request.id === request.current) {
        setDraft("");
        request.current = uid();
        void AsyncStorage.removeItem(draftKey(id)).catch(() => {});
        setNotice("Your previously submitted reply is confirmed as sent.");
      }
      if (
        !parent.current ||
        !r.messages.some((m: InboxMessage) => m.id === parent.current)
      ) {
        const incoming = [...r.messages]
          .reverse()
          .find((m: InboxMessage) => m.direction === "inbound");
        if (incoming) {
          parent.current = incoming.id;
          setParentId(incoming.id);
        }
      }
    } catch (e) {
      if (mounted.current && active.current === id)
        setError((e as Error).message);
    } finally {
      if (mounted.current && active.current === id) setOpening(false);
    }
  }
  useEffect(() => {
    if (!conversation || !messages.length) return;
    const latest = [...messages]
      .reverse()
      .find((m) => m.direction === "inbound")?.received_at;
    if (!latest || marked.current[conversation.id] === latest) return;
    marked.current[conversation.id] = latest;
    const id = conversation.id;
    const mark = demo
      ? Promise.resolve()
      : api("inbox-read", { conversation_id: id, through: latest });
    void mark
      .then(() => {
        if (!mounted.current || active.current !== id) return;
        setConversation((c) => (c ? { ...c, last_read_at: latest } : c));
        setRows((old) =>
          old.map((c) => (c.id === id ? { ...c, last_read_at: latest } : c)),
        );
        if (!demo) void list();
      })
      .catch(() => {
        delete marked.current[id];
      });
  }, [selectedId, messages]);
  async function earlier() {
    if (!before || older) return;
    const id = active.current;
    setOlder(true);
    try {
      const r = await api("inbox-open", {
        conversation_id: id,
        sync: false,
        before,
      });
      if (active.current === id) {
        setMessages((old) => [
          ...r.messages,
          ...old.filter(
            (m) => !r.messages.some((x: InboxMessage) => x.id === m.id),
          ),
        ]);
        setBefore(r.next_before);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOlder(false);
    }
  }
  async function generate() {
    if (!parentId) return;
    const id = active.current,
      rev = revision.current,
      replyTo = parentId;
    setDrafting(true);
    setError("");
    try {
      const r = demo
        ? {
            body: "Hi Ada,\n\nThanks for getting back to me. The complimentary review focuses on your website’s path to a direct booking, with three practical recommendations.\n\nIs there a particular part of your booking process you’d like us to focus on?",
          }
        : await api("inbox-draft", {
            conversation_id: id,
            message_id: replyTo,
            notes,
          });
      if (
        active.current !== id ||
        revision.current !== rev ||
        parent.current !== replyTo
      ) {
        setNotice(
          "Your draft changed while AI was writing. Your edits were kept; generate again when ready.",
        );
        return;
      }
      editDraft(r.body);
      setNotice(
        demo
          ? "Sample AI draft. Edit it before saving a demo reply."
          : "AI draft ready. Review and edit it, then select Send reply.",
      );
    } catch (e) {
      if (active.current === id) setError((e as Error).message);
    } finally {
      if (mounted.current) setDrafting(false);
    }
  }
  async function send() {
    if (!draft.trim() || !parentId || sending) return;
    const id = active.current,
      body = draft,
      requestId = request.current;
    setSending(true);
    setError("");
    // Persist the request identity before sending, so a lost HTTP response cannot cause a duplicate.
    await AsyncStorage.setItem(
      draftKey(id),
      JSON.stringify({ body, request_id: requestId, parent_id: parentId }),
    ).catch(() => {});
    try {
      if (demo) {
        const original = messages.find((m) => m.id === parentId)!;
        const at = new Date().toISOString();
        setMessages((old) => [
          ...old,
          {
            ...original,
            id: uid(),
            provider_message_id: uid(),
            direction: "outbound",
            from_email: "you@agency.example",
            from_name: "Your agency",
            to_emails: [original.from_email],
            body_text: body,
            received_at: at,
          },
        ]);
        setConversation((c) =>
          c
            ? {
                ...c,
                last_outbound_at: at,
                last_message_at: at,
                last_preview: body.slice(0, 220),
              }
            : c,
        );
        editDraft("");
        setNotice("Demo reply saved in this preview. No email was sent.");
        return;
      }
      const r = await api("inbox-send", {
        conversation_id: id,
        message_id: parentId,
        request_id: requestId,
        body,
      });
      if (active.current !== id) return;
      setDelivery(r.request);
      if (r.request.state === "sent") {
        editDraft("");
        await AsyncStorage.removeItem(draftKey(id));
        setNotice("Reply sent from your campaign mailbox.");
        await open(id, false);
        await list();
      } else
        setError(
          r.request.last_error ||
            "Your reply is awaiting delivery confirmation. Refresh before sending again.",
        );
    } catch {
      if (active.current === id) {
        setDelivery({ id: requestId, state: "uncertain" });
        setError(
          "The reply outcome could not be confirmed. Refresh the conversation to check its status before sending again. Your draft is saved.",
        );
      }
    } finally {
      if (mounted.current) setSending(false);
    }
  }
  const label = { color: t.text, fontSize: 14, lineHeight: 21 } as const;
  const muted = { ...label, color: t.muted };
  const panel = {
    backgroundColor: t.panel,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 16,
    padding: 20,
  };
  const button = (
    title: string,
    onPress: () => void,
    Icon: any,
    disabled = false,
    primary = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        borderRadius: 9,
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderWidth: 1,
        borderColor: primary ? t.accent : t.border,
        backgroundColor: primary ? t.accent : t.raised,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon size={16} color={primary ? t.accentText : t.text} />
      <Text
        style={{
          fontSize: 14,
          color: primary ? t.accentText : t.text,
          fontWeight: "600",
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
  const parentMessage = messages.find((m) => m.id === parentId);
  const blocked =
    delivery?.state === "sending" || delivery?.state === "uncertain";
  return (
    <View style={{ gap: 20 }}>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <View style={{ flex: 1, minWidth: 200 }}>
          <Text style={{ color: t.text, fontSize: 25, fontWeight: "600" }}>
            Campaign inbox
          </Text>
          <Text style={[muted, { marginTop: 7 }]}>
            Read every response. Keep the conversation moving.
          </Text>
        </View>
        {button(
          syncing ? "Syncing replies…" : "Sync replies",
          () => void sync(),
          RefreshCw,
          syncing || sending,
        )}
      </View>
      {demo && (
        <Text
          style={[
            muted,
            { padding: 14, backgroundColor: t.soft, borderRadius: 10 },
          ]}
        >
          Demo inbox · Sample contacts and messages. No emails are sent.
        </Text>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {[
          ["Responders", summary.responders],
          ["Responses", summary.responses],
          ["Unread", summary.unread],
          ["Awaiting your reply", summary.awaiting],
        ].map(([title, value]) => (
          <View
            key={title}
            style={{ ...panel, flexGrow: 1, flexBasis: 160, padding: 16 }}
          >
            <Text style={muted}>{title}</Text>
            <Text
              style={{
                fontSize: 28,
                fontWeight: "600",
                color: t.text,
                marginTop: 7,
              }}
            >
              {value}
            </Text>
          </View>
        ))}
      </View>
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={[
            label,
            {
              color: t.danger,
              padding: 14,
              borderWidth: 1,
              borderColor: t.danger,
              borderRadius: 10,
            },
          ]}
        >
          {error}
        </Text>
      )}
      {!!notice && (
        <Text
          accessibilityLiveRegion="polite"
          style={[label, { color: t.accent }]}
        >
          {notice}
        </Text>
      )}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
        }}
      >
        {button(
          filter === "responses" ? "Responses only" : "All conversations",
          () => setFilter((v) => (v === "responses" ? "all" : "responses")),
          MessageSquare,
        )}
        <ScrollView
          horizontal
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 7, alignItems: "center" }}
        >
          {[{ id: "", name: "All campaigns" }, ...campaigns].map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityState={{ selected: campaignId === c.id }}
              onPress={() => {
                setCampaignId(c.id);
                active.current = "";
                setSelectedId("");
                setConversation(null);
              }}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 8,
                backgroundColor: campaignId === c.id ? t.soft : t.raised,
                borderWidth: 1,
                borderColor: campaignId === c.id ? t.accent : t.border,
              }}
            >
              <Text
                style={{
                  ...label,
                  color: campaignId === c.id ? t.accent : t.text,
                }}
              >
                {c.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View
        style={{
          flexDirection: narrow ? "column" : "row",
          alignItems: "stretch",
          gap: 16,
        }}
      >
        {(!narrow || !selectedId) && (
          <View
            style={{
              ...panel,
              padding: 0,
              width: narrow ? "100%" : 320,
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                padding: 14,
                borderBottomWidth: 1,
                borderColor: t.border,
              }}
            >
              <Search size={17} color={t.muted} />
              <TextInput
                accessibilityLabel="Search campaign responses"
                value={search}
                onChangeText={setSearch}
                placeholder="Search names, emails, responses"
                placeholderTextColor={t.muted}
                style={{ ...label, flex: 1, padding: 4 }}
              />
            </View>
            <ScrollView style={{ maxHeight: 650 }}>
              {loading && (
                <ActivityIndicator color={t.accent} style={{ margin: 20 }} />
              )}
              {rows.map((c) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open conversation with ${c.last_sender_name || c.contact_name || c.contact_email}`}
                  accessibilityState={{ selected: selectedId === c.id }}
                  onPress={() => void open(c.id)}
                  style={{
                    padding: 18,
                    gap: 7,
                    borderBottomWidth: 1,
                    borderColor: t.border,
                    backgroundColor: selectedId === c.id ? t.soft : t.panel,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={{
                        ...label,
                        fontWeight: inboxUnread(c) ? "700" : "500",
                        flex: 1,
                      }}
                    >
                      {c.last_sender_name || c.contact_name || c.contact_email}
                    </Text>
                    {inboxUnread(c) && (
                      <Text
                        style={{
                          color: t.accent,
                          fontSize: 12,
                          fontWeight: "700",
                        }}
                      >
                        NEW
                      </Text>
                    )}
                  </View>
                  <Text style={muted} numberOfLines={1}>
                    {c.company} · {c.last_sender_email || c.contact_email}
                  </Text>
                  <Text style={label} numberOfLines={2}>
                    {c.last_preview ||
                      (c.last_reply_at
                        ? "Response detected. Open to load the message."
                        : "Open to read this conversation.")}
                  </Text>
                  <Text style={{ ...muted, fontSize: 12 }}>
                    {campaigns.find((x) => x.id === c.campaign_id)?.name}
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <Text style={{ ...muted, fontSize: 12 }}>
                      {when(c.last_message_at)}
                    </Text>
                    {inboxNeedsReply(c) && (
                      <Text style={{ fontSize: 12, color: t.accent }}>
                        Needs reply
                      </Text>
                    )}
                  </View>
                </Pressable>
              ))}
              {!loading && !rows.length && (
                <View style={{ padding: 28, gap: 10, alignItems: "center" }}>
                  <Inbox size={30} color={t.muted} />
                  <Text style={label}>
                    {search ? "No matching conversations" : "No responses yet"}
                  </Text>
                  <Text style={[muted, { textAlign: "center" }]}>
                    {search
                      ? "Try another name or email address."
                      : "Replies to sent campaigns will appear here. Sync replies to check your connected mailboxes."}
                  </Text>
                </View>
              )}
              {nextOffset !== null && (
                <View style={{ padding: 14 }}>
                  {button(
                    "Load more conversations",
                    () => void list(nextOffset),
                    MessageSquare,
                    loading,
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        )}
        {(!narrow || selectedId) && (
          <View style={{ ...panel, flex: 1, minWidth: 0, gap: 16 }}>
            {!selectedId ? (
              <View
                style={{
                  minHeight: 400,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                }}
              >
                <MessageSquare size={36} color={t.accent} />
                <Text style={{ ...label, fontSize: 20, fontWeight: "600" }}>
                  Open a conversation
                </Text>
                <Text style={[muted, { textAlign: "center", maxWidth: 360 }]}>
                  See who responded, read their message, and reply from your
                  campaign’s sending account.
                </Text>
              </View>
            ) : (
              <>
                <View style={{ gap: 12 }}>
                  {narrow &&
                    button(
                      "Back to conversations",
                      () => {
                        active.current = "";
                        setSelectedId("");
                      },
                      ChevronLeft,
                    )}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{ ...label, fontSize: 19, fontWeight: "600" }}
                      >
                        {conversation?.contact_name ||
                          conversation?.contact_email ||
                          "Conversation"}
                      </Text>
                      <Text style={muted}>{conversation?.company}</Text>
                    </View>
                    {button(
                      opening ? "Refreshing…" : "Refresh conversation",
                      () => void open(selectedId),
                      RefreshCw,
                      opening || sending,
                    )}
                  </View>
                  <Text style={muted}>
                    Sending from{" "}
                    {mailboxes.find((m) => m.id === conversation?.mailbox_id)
                      ?.email ||
                      (demo
                        ? "you@agency.example"
                        : "the original campaign mailbox")}
                  </Text>
                  {!!conversation?.sync_error && (
                    <Text style={{ ...label, color: t.danger }}>
                      {conversation.sync_error}
                    </Text>
                  )}
                  {!!conversation?.sync_cursor && (
                    <Text style={muted}>
                      Older mailbox history is still syncing. Refresh to
                      continue loading it.
                    </Text>
                  )}
                </View>
                <ScrollView
                  style={{ maxHeight: 490, minHeight: 160 }}
                  contentContainerStyle={{ gap: 14, paddingVertical: 8 }}
                >
                  {before &&
                    button(
                      older ? "Loading history…" : "Load earlier messages",
                      () => void earlier(),
                      MessageSquare,
                      older,
                    )}
                  {opening && !messages.length && (
                    <ActivityIndicator
                      color={t.accent}
                      style={{ margin: 24 }}
                    />
                  )}
                  {!opening && !messages.length && (
                    <Text style={muted}>
                      No message content has synced yet. Refresh the
                      conversation to try again.
                    </Text>
                  )}
                  {messages.map((m) => (
                    <View
                      key={m.id}
                      style={{
                        padding: 16,
                        borderRadius: 12,
                        backgroundColor:
                          m.direction === "outbound" ? t.raised : t.bg,
                        borderWidth: 1,
                        borderColor: parentId === m.id ? t.accent : t.border,
                        gap: 9,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          flexWrap: "wrap",
                          justifyContent: "space-between",
                          gap: 6,
                        }}
                      >
                        <Text
                          selectable
                          style={{ ...label, fontWeight: "600" }}
                        >
                          {m.direction === "outbound"
                            ? "You"
                            : m.from_name || m.from_email}
                        </Text>
                        <Text style={{ ...muted, fontSize: 12 }}>
                          {when(m.received_at)}
                        </Text>
                      </View>
                      <Text selectable style={muted}>
                        From: {m.from_email}
                      </Text>
                      <Text selectable style={muted}>
                        To: {m.to_emails.join(", ")}
                      </Text>
                      <Text selectable style={{ ...label, fontWeight: "600" }}>
                        {m.subject}
                      </Text>
                      <Text
                        selectable
                        style={{ ...label, fontSize: 16, lineHeight: 25 }}
                      >
                        {m.body_text || "(This message has no text content.)"}
                      </Text>
                      {m.body_truncated && (
                        <Text style={muted}>
                          This unusually long message is shortened. Open your
                          mailbox to read the remainder.
                        </Text>
                      )}
                      {m.direction === "inbound" &&
                        button(
                          parentId === m.id
                            ? "Replying to this message"
                            : "Reply to this message",
                          () => {
                            pickParent(m.id);
                            revision.current++;
                          },
                          CheckCheck,
                          sending,
                        )}
                    </View>
                  ))}
                </ScrollView>
                {parentMessage ? (
                  <View
                    style={{
                      borderTopWidth: 1,
                      borderColor: t.border,
                      paddingTop: 18,
                      gap: 12,
                    }}
                  >
                    <Text style={{ ...label, fontWeight: "600" }}>
                      Reply to{" "}
                      {parentMessage.from_name || parentMessage.from_email}
                    </Text>
                    <Text selectable style={muted}>
                      {parentMessage.from_email} · {parentMessage.subject}
                    </Text>
                    <TextInput
                      accessibilityLabel="Instructions for AI reply"
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="Optional direction for AI, e.g. ask about their priorities"
                      placeholderTextColor={t.muted}
                      maxLength={1000}
                      style={{
                        ...label,
                        borderColor: t.border,
                        borderWidth: 1,
                        borderRadius: 9,
                        padding: 12,
                      }}
                    />
                    <View style={{ alignItems: "flex-start" }}>
                      {button(
                        drafting ? "Writing draft…" : "Generate AI draft",
                        () => void generate(),
                        Sparkles,
                        drafting || sending,
                      )}
                    </View>
                    <TextInput
                      accessibilityLabel="Your reply"
                      multiline
                      value={draft}
                      onChangeText={editDraft}
                      editable={!sending}
                      maxLength={12000}
                      placeholder="Type your reply here, or generate an AI draft and edit it…"
                      placeholderTextColor={t.muted}
                      style={{
                        ...label,
                        fontSize: 16,
                        lineHeight: 25,
                        textAlignVertical: "top",
                        minHeight: 165,
                        borderWidth: 1,
                        borderColor: t.border,
                        borderRadius: 10,
                        padding: 14,
                      }}
                    />
                    <Text style={{ ...muted, fontSize: 12 }}>
                      Your campaign signature is appended when sending. AI
                      drafts are editable and are never sent automatically.
                    </Text>
                    {blocked && (
                      <Text style={{ ...label, color: t.danger }}>
                        A reply is awaiting delivery confirmation. Refresh this
                        conversation before sending another message.
                      </Text>
                    )}
                    <View style={{ alignItems: "flex-end" }}>
                      {button(
                        sending
                          ? "Sending reply…"
                          : demo
                            ? "Save demo reply"
                            : "Send reply",
                        () => void send(),
                        Send,
                        !draft.trim() ||
                          sending ||
                          blocked ||
                          !parentMessage.reply_reference,
                        true,
                      )}
                    </View>
                  </View>
                ) : (
                  !opening && (
                    <Text style={muted}>
                      The reply composer becomes available when an incoming
                      message has synced.
                    </Text>
                  )
                )}
              </>
            )}
          </View>
        )}
      </View>
      <Text style={{ ...muted, fontSize: 12 }}>
        Responses count incoming messages; responders count campaign contacts
        who replied. Conversation text is shown without loading remote images.
        The inbox refreshes every 30 seconds while open.
      </Text>
    </View>
  );
}
