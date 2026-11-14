import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  Linking,
  ActivityIndicator,
  AppState,
  Platform,
  useWindowDimensions,
} from "react-native";
import {
  Search,
  ArrowUpRight,
  Radar,
  Link2,
  CheckCircle2,
  X,
  Mail,
  BriefcaseBusiness,
} from "lucide-react-native";
import { api } from "../supabase";
import {
  externalUrl,
  type UpworkJob,
  type UpworkReport,
  type UpworkApplication,
} from "../upwork";
import type { ScoutingProfile, Mailbox } from "../domain";
type Theme = {
  bg: string;
  panel: string;
  raised: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  danger: string;
  blue: string;
};
type Scout = {
  id: string;
  job_id: string;
  status: "researching" | "completed" | "failed";
  report?: UpworkReport;
  error?: string;
  progress?: {
    phase: string;
    searches: number;
    search_budget: number;
    pages: number;
    page_budget: number;
    blocked: number;
    failures: number;
  };
};
function Button({
  label,
  onPress,
  t,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  t: Theme;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: secondary ? t.raised : t.accent,
        borderColor: secondary ? t.border : t.accent,
        borderWidth: 1,
        borderRadius: 9,
        paddingHorizontal: 15,
        paddingVertical: 12,
        alignSelf: "flex-start",
        maxWidth: "100%",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text
        style={{
          color: secondary ? t.text : t.accentText,
          fontSize: 13,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChangeText,
  t,
  multiline = false,
  placeholder = "",
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  t: Theme;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: t.text, fontSize: 13 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        style={{
          borderWidth: 1,
          borderColor: t.border,
          borderRadius: 9,
          padding: 13,
          color: t.text,
          backgroundColor: t.bg,
          fontSize: 14,
          lineHeight: 22,
          minHeight: multiline ? 210 : 46,
          textAlignVertical: "top",
        }}
      />
    </View>
  );
}
function Link({ url, label, t }: { url: string; label: string; t: Theme }) {
  const safe = externalUrl(url);
  return safe ? (
    <Pressable
      accessibilityRole="link"
      onPress={() => void Linking.openURL(safe)}
      style={{
        maxWidth: "100%",
        flexDirection: "row",
        gap: 6,
        alignItems: "center",
      }}
    >
      <Text
        style={{ color: t.blue, fontSize: 12, lineHeight: 20, flexShrink: 1 }}
      >
        {label}
      </Text>
      <ArrowUpRight size={13} color={t.blue} />
    </Pressable>
  ) : null;
}
export function UpworkScouting({
  t,
  demo,
  profiles,
  mailboxes,
  onSignIn,
  onEmailAccounts,
}: {
  t: Theme;
  demo: boolean;
  profiles: ScoutingProfile[];
  mailboxes: Mailbox[];
  onSignIn: () => void;
  onEmailAccounts: () => void;
}) {
  const [connection, setConnection] = useState<any>(null),
    [jobs, setJobs] = useState<UpworkJob[]>([]),
    [known, setKnown] = useState<UpworkJob[]>([]),
    [scouts, setScouts] = useState<Scout[]>([]),
    [applications, setApplications] = useState<UpworkApplication[]>([]);
  const [query, setQuery] = useState(""),
    [tab, setTab] = useState<"Jobs" | "Scouting results" | "Applications">(
      "Jobs",
    ),
    [next, setNext] = useState(""),
    [feedKind, setFeedKind] = useState("saved"),
    [mode, setMode] = useState<"feed" | "search">("feed"),
    [executedQuery, setExecutedQuery] = useState("");
  const [detail, setDetail] = useState<UpworkJob | null>(null),
    [compose, setCompose] = useState<{ job: UpworkJob; email: string } | null>(
      null,
    ),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [profileId, setProfileId] = useState(profiles[0]?.id || ""),
    [mailboxId, setMailboxId] = useState(
      mailboxes.find((m) => m.status === "connected")?.id || "",
    ),
    [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(""),
    [active, setActive] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loaded, setLoaded] = useState(false);
  const mounted = useRef(true),
    driving = useRef(false),
    { width } = useWindowDimensions();
  const card = {
    backgroundColor: t.panel,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    padding: width < 600 ? 17 : 24,
    gap: 15,
  } as const;
  const text = { color: t.text, fontSize: 14, lineHeight: 23 },
    muted = { color: t.muted, fontSize: 12, lineHeight: 21 },
    row = {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      alignItems: "center",
    } as const;
  async function refresh() {
    if (demo) return;
    const r = await api("upwork-status");
    if (!mounted.current) return;
    setConnection(r.connection);
    setKnown(r.jobs || []);
    setJobs((current) => (loaded ? current : r.jobs || []));
    setScouts(r.scouts || []);
    setApplications(r.applications || []);
    setLoaded(true);
  }
  useEffect(() => {
    mounted.current = true;
    if (!demo)
      refresh().catch((e) => {
        if (mounted.current) setError(e.message);
      });
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && !demo) void refresh().catch(() => {});
    });
    return () => {
      mounted.current = false;
      sub.remove();
    };
  }, [demo]);
  async function perform(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e: any) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  const jobFor = (id: string) =>
    known.find((j) => j.id === id) || jobs.find((j) => j.id === id);
  function mergeJobs(incoming: UpworkJob[]) {
    setKnown((old) => [
      ...incoming,
      ...old.filter((j) => !incoming.some((x) => x.id === j.id)),
    ]);
  }
  async function fetchJobs(kind: "feed" | "search", more = false) {
    await perform(more ? "Loading more jobs" : "Loading jobs", async () => {
      const r = await api(kind === "feed" ? "upwork-feed" : "upwork-search", {
        query: kind === "search" ? (more ? executedQuery : query) : "",
        ...(more ? { cursor: next } : {}),
      });
      if (!mounted.current) return;
      setJobs((old) =>
        more
          ? [
              ...old,
              ...r.jobs.filter(
                (j: UpworkJob) => !old.some((o) => o.id === j.id),
              ),
            ]
          : r.jobs,
      );
      mergeJobs(r.jobs);
      setNext(r.next_cursor || "");
      setFeedKind(r.feed_kind || "latest");
      setMode(kind);
      if (kind === "search" && !more) setExecutedQuery(query);
      setTab("Jobs");
    });
  }
  async function openJob(job: UpworkJob) {
    setDetail(job);
    await perform("Loading job details", async () => {
      const r = await api("upwork-job", { job_id: job.id });
      if (mounted.current && r.job) {
        setDetail(r.job);
        mergeJobs([r.job]);
      }
    });
  }
  const updateScout = (s: Scout) =>
    setScouts((old) => [s, ...old.filter((x) => x.id !== s.id)]);
  async function drive(id: string) {
    if (driving.current) return;
    driving.current = true;
    setActive(id);
    setError("");
    try {
      for (let i = 0; i < 55 && mounted.current; i++) {
        const r = await api("upwork-scout-step", { scout_id: id });
        if (!mounted.current) break;
        updateScout(r.scout);
        if (r.scout.status !== "researching") {
          if (r.scout.status === "failed")
            setError(r.scout.error || "This scout was interrupted.");
          break;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, r.busy ? 2000 : 350),
        );
      }
    } catch (e: any) {
      if (mounted.current) {
        setError(e.message);
        void refresh().catch(() => {});
      }
    } finally {
      driving.current = false;
      if (mounted.current) setActive("");
    }
  }
  async function scout(job: UpworkJob) {
    if (active) return;
    await perform("Starting deep research", async () => {
      const r = await api("upwork-scout-start", { job_id: job.id });
      updateScout({ ...r.scout, job_id: job.id });
      setDetail(null);
      setTab("Scouting results");
      if (r.scout.status === "researching") void drive(r.scout.id);
    });
  }
  function openApplication(job: UpworkJob, email: string) {
    setDetail(null);
    setCompose({ job, email });
    setSubject(`Application: ${job.title}`.slice(0, 250));
    setBody("");
    setConfirmed(false);
    setError("");
  }
  function renderReport(s: Scout, job: UpworkJob) {
    const report = s.report;
    return (
      <View style={{ gap: 13 }}>
        {s.progress && (
          <Text style={muted}>
            {s.status === "researching"
              ? `Deep research · ${s.progress.phase}`
              : "Research coverage"}{" "}
            · {s.progress.searches}/{s.progress.search_budget} searches ·{" "}
            {s.progress.pages}/{s.progress.page_budget} public pages read
          </Text>
        )}
        {s.status === "researching" && (
          <>
            <Text style={text}>
              Finding clues, following public sources, and checking client
              identity.
            </Text>
            {active === s.id ? (
              <View style={row}>
                <ActivityIndicator color={t.accent} />
                <Text style={muted}>
                  Research in progress. Progress is saved between steps.
                </Text>
              </View>
            ) : (
              <Button
                label="Resume research"
                t={t}
                disabled={!!active || !!busy}
                onPress={() => void drive(s.id)}
              />
            )}
          </>
        )}
        {s.status === "failed" && (
          <>
            <Text style={{ ...muted, color: t.danger }}>
              {s.error || "Research was interrupted."}
            </Text>
            <Button
              label="Retry this scout"
              t={t}
              disabled={!!active || !!busy}
              onPress={() => void scout(job)}
            />
          </>
        )}
        {report && (
          <>
            <Text style={{ ...text, fontWeight: "600", fontSize: 17 }}>
              {report.outcome === "nothing_found"
                ? "Nothing found"
                : report.outcome === "contact_found"
                  ? "Contact details found"
                  : "Website or social profiles found"}
              {report.company ? ` · ${report.company}` : ""}
            </Text>
            <Text style={muted}>{report.summary}</Text>
            {report.partial && (
              <Text style={muted}>
                Some sources were unavailable or blocked. This result covers the
                accessible public sources.
              </Text>
            )}
            {report.contacts.map((c, i) => (
              <View
                key={i}
                style={{
                  padding: 14,
                  borderRadius: 9,
                  backgroundColor: t.bg,
                  gap: 8,
                }}
              >
                <Text selectable style={text}>
                  {c.kind.toUpperCase()} · {c.value}
                </Text>
                <Text selectable style={muted}>
                  “{c.quote}”
                </Text>
                <Link url={c.source_url} label="View contact source" t={t} />
                {c.kind === "email" && (
                  <Button
                    label="Apply by email"
                    t={t}
                    disabled={
                      !!busy ||
                      applications.some(
                        (a) =>
                          a.job_id === job.id &&
                          ["sending", "sent", "uncertain"].includes(a.status),
                      )
                    }
                    onPress={() => openApplication(job, c.value)}
                  />
                )}
              </View>
            ))}
            {!!report.sources.length && (
              <View style={{ gap: 8 }}>
                <Text style={{ ...text, fontWeight: "600" }}>
                  Client identity evidence
                </Text>
                {report.sources.map((s, i) => (
                  <View key={i} style={{ gap: 5 }}>
                    <Text style={muted}>“{s.quote}”</Text>
                    <Link url={s.url} label="View identity source" t={t} />
                  </View>
                ))}
              </View>
            )}
            <Text style={muted}>
              Researched {new Date(report.searched_at).toLocaleString()}.
              Matches are based on published information, not private Upwork
              client data.
            </Text>
            {!!report.queries.length && (
              <Text selectable style={muted}>
                Search trail: {report.queries.join(" · ")}
              </Text>
            )}
          </>
        )}
      </View>
    );
  }
  const detailScout = detail
    ? scouts.find((s) => s.job_id === detail.id)
    : undefined;
  return (
    <View style={{ gap: 22 }}>
      <View style={card}>
        <View style={row}>
          <BriefcaseBusiness color={t.accent} size={22} />
          <Text style={{ ...text, fontSize: 23, fontWeight: "600" }}>
            Upwork Scouting
          </Text>
        </View>
        <Text style={muted}>
          Discover jobs, investigate the clues behind each post, and keep your
          research and applications together.
        </Text>
        {demo ? (
          <>
            <Text style={text}>
              Sign in to connect your own Upwork account.
            </Text>
            <Button
              label="Sign in to connect Upwork"
              t={t}
              onPress={onSignIn}
            />
          </>
        ) : (
          <View style={row}>
            {connection?.status === "connected" ? (
              <>
                <CheckCircle2 size={17} color={t.accent} />
                <Text style={text}>Upwork connected</Text>
                <Button
                  label="Disconnect Upwork"
                  t={t}
                  secondary
                  disabled={!!busy || !!active}
                  onPress={() =>
                    void perform("Disconnecting", async () => {
                      await api("upwork-disconnect");
                      await refresh();
                      setNotice(
                        "Upwork disconnected. Your saved research and application history remain private to you.",
                      );
                    })
                  }
                />
              </>
            ) : (
              <Button
                label={connection ? "Reconnect Upwork" : "Connect Upwork"}
                t={t}
                disabled={!!busy}
                onPress={() =>
                  void perform("Connecting to Upwork", async () => {
                    const r = await api("upwork-connect");
                    await Linking.openURL(r.url);
                    setNotice(
                      Platform.OS === "web"
                        ? "Complete Upwork authorization, then return to this section."
                        : "Complete authorization in the browser, then return here and refresh.",
                    );
                  })
                }
              />
            )}
            <Button
              label="Refresh connection & history"
              t={t}
              secondary
              disabled={!!busy}
              onPress={() => void perform("Refreshing", refresh)}
            />
          </View>
        )}
        <Text style={muted}>
          Connection uses Upwork’s official MCP OAuth. You authorize your own
          account; AISAS does not ask for your Upwork password.
        </Text>
      </View>
      {!!busy && (
        <View style={row}>
          <ActivityIndicator color={t.accent} />
          <Text style={muted}>{busy}…</Text>
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ ...text, color: t.danger }}>
          {error}
        </Text>
      )}
      {!!notice && <Text style={text}>{notice}</Text>}
      {!demo && (
        <>
          <View style={row}>
            {(["Jobs", "Scouting results", "Applications"] as const).map(
              (label) => (
                <Button
                  key={label}
                  label={`${label}${label === "Scouting results" ? ` (${scouts.length})` : label === "Applications" ? ` (${applications.length})` : ""}`}
                  t={t}
                  secondary={tab !== label}
                  onPress={() => setTab(label)}
                />
              ),
            )}
          </View>
          {tab === "Jobs" && (
            <>
              <View style={card}>
                <Field
                  label="Search Upwork jobs"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="e.g. AI receptionist, website redesign, HVAC automation"
                  t={t}
                />
                <View style={row}>
                  <Button
                    label="Search jobs"
                    t={t}
                    disabled={
                      !!busy ||
                      !query.trim() ||
                      connection?.status !== "connected"
                    }
                    onPress={() => void fetchJobs("search")}
                  />
                  <Button
                    label="Load my job feed"
                    t={t}
                    secondary
                    disabled={!!busy || connection?.status !== "connected"}
                    onPress={() => void fetchJobs("feed")}
                  />
                </View>
                <Text style={muted}>
                  {feedKind === "personalized"
                    ? "Your Upwork job feed"
                    : feedKind === "saved"
                      ? "Recently viewed jobs saved in AISAS"
                      : "Latest jobs from the search/list tools available to your Upwork account"}
                  . Job availability depends on the permissions Upwork grants
                  your account.
                </Text>
              </View>
              {!jobs.length && (
                <View style={card}>
                  <Text style={text}>No jobs to show yet.</Text>
                  <Text style={muted}>
                    Connect Upwork, then load your feed or search for a project.
                  </Text>
                </View>
              )}
              {jobs.map((job) => (
                <View key={job.id} style={card}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View job: ${job.title}`}
                    onPress={() => void openJob(job)}
                  >
                    <Text style={{ ...text, fontSize: 18, fontWeight: "600" }}>
                      {job.title}
                    </Text>
                  </Pressable>
                  <Text style={muted}>
                    {[
                      job.company,
                      job.location,
                      job.budget ? `Budget: ${job.budget}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Client details available in job post"}
                  </Text>
                  <Text numberOfLines={3} style={text}>
                    {job.description ||
                      "Open the job to see the available details."}
                  </Text>
                  {!!job.skills.length && (
                    <Text style={muted}>{job.skills.join(" · ")}</Text>
                  )}
                  <View style={row}>
                    <Button
                      label="View job details"
                      t={t}
                      secondary
                      disabled={!!busy}
                      onPress={() => void openJob(job)}
                    />
                    <Button
                      label="Scout this job"
                      t={t}
                      disabled={!!busy || !!active}
                      onPress={() => void scout(job)}
                    />
                    <Link url={job.url} label="Apply on Upwork" t={t} />
                  </View>
                </View>
              ))}
              {!!next && (
                <Button
                  label="Load more jobs"
                  t={t}
                  secondary
                  disabled={!!busy}
                  onPress={() => void fetchJobs(mode, true)}
                />
              )}
            </>
          )}
          {tab === "Scouting results" && (
            <>
              {!scouts.length && (
                <View style={card}>
                  <Radar size={22} color={t.accent} />
                  <Text style={text}>Scout a job to begin deep research.</Text>
                  <Text style={muted}>
                    AI examines the whole post, searches Google and Bing,
                    follows linked pages and new clues, then checks each contact
                    against source evidence. Each scout allows up to 20 searches
                    and 30 public pages.
                  </Text>
                </View>
              )}
              {scouts.map((s) => {
                const job = jobFor(s.job_id);
                return job ? (
                  <View key={s.id} style={card}>
                    <Text style={{ ...text, fontSize: 18, fontWeight: "600" }}>
                      {job.title}
                    </Text>
                    {renderReport(s, job)}
                    <Link url={job.url} label="Apply on Upwork" t={t} />
                  </View>
                ) : null;
              })}
            </>
          )}
          {tab === "Applications" && (
            <>
              {!applications.length && (
                <View style={card}>
                  <Mail size={22} color={t.accent} />
                  <Text style={text}>
                    Your email applications will appear here.
                  </Text>
                  <Text style={muted}>
                    Review the message and choose a connected sending account
                    before sending. These are direct emails, not proposals
                    submitted through Upwork.
                  </Text>
                </View>
              )}
              {applications.map((a) => (
                <View key={a.id} style={card}>
                  <Text style={{ ...text, fontSize: 17, fontWeight: "600" }}>
                    {jobFor(a.job_id)?.title || "Upwork job"}
                  </Text>
                  <Text
                    style={{
                      ...muted,
                      color:
                        a.status === "failed" || a.status === "uncertain"
                          ? t.danger
                          : t.accent,
                    }}
                  >
                    {a.status.toUpperCase()} · {a.email} ·{" "}
                    {new Date(a.sent_at || a.created_at).toLocaleString()}
                  </Text>
                  <Text style={text}>{a.subject}</Text>
                  <Text selectable style={muted}>
                    {a.body}
                  </Text>
                  {!!a.error && (
                    <Text style={{ ...muted, color: t.danger }}>{a.error}</Text>
                  )}
                  {a.status === "sent" && (
                    <Text style={muted}>
                      Accepted by your email provider. This does not confirm
                      inbox delivery or an Upwork proposal.
                    </Text>
                  )}
                </View>
              ))}
            </>
          )}
        </>
      )}
      <Modal
        visible={!!detail || !!compose}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) {
            setDetail(null);
            setCompose(null);
          }
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,.65)",
            justifyContent: "center",
            padding: width < 600 ? 10 : 30,
          }}
        >
          <View
            style={{
              maxHeight: "95%",
              width: "100%",
              maxWidth: 850,
              alignSelf: "center",
              backgroundColor: t.panel,
              borderColor: t.border,
              borderWidth: 1,
              borderRadius: 15,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                padding: 20,
                flexDirection: "row",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <Text
                style={{ ...text, fontSize: 20, fontWeight: "600", flex: 1 }}
              >
                {compose ? "Review email application" : "Job details"}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close Upwork dialog"
                disabled={!!busy}
                onPress={() => {
                  setDetail(null);
                  setCompose(null);
                }}
              >
                <X color={t.muted} size={22} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                padding: width < 600 ? 17 : 25,
                gap: 20,
              }}
            >
              {!!error && (
                <Text
                  accessibilityRole="alert"
                  style={{ ...text, color: t.danger }}
                >
                  {error}
                </Text>
              )}
              {!!busy && <Text style={muted}>{busy}…</Text>}
              {detail && (
                <>
                  <Text style={{ ...text, fontSize: 22, fontWeight: "600" }}>
                    {detail.title}
                  </Text>
                  <Text style={muted}>
                    {[detail.company, detail.location, detail.budget]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                  <Text selectable style={text}>
                    {detail.description ||
                      "Upwork did not provide a description through the available tool. Open the original post to review it."}
                  </Text>
                  <Text style={muted}>{detail.skills.join(" · ")}</Text>
                  <View style={row}>
                    <Button
                      label="Scout this job"
                      t={t}
                      disabled={!!busy || !!active}
                      onPress={() => void scout(detail)}
                    />
                    <Link
                      url={detail.url}
                      label="Open job / Apply on Upwork"
                      t={t}
                    />
                  </View>
                  {detailScout && renderReport(detailScout, detail)}
                </>
              )}
              {compose && (
                <>
                  <Text style={text}>{compose.job.title}</Text>
                  <Text selectable style={muted}>
                    To: {compose.email}
                  </Text>
                  <Text style={text}>Sending email account</Text>
                  <View style={row}>
                    {mailboxes
                      .filter((m) => m.status === "connected")
                      .map((m) => (
                        <Button
                          key={m.id}
                          label={m.email}
                          t={t}
                          secondary={mailboxId !== m.id}
                          onPress={() => setMailboxId(m.id)}
                        />
                      ))}
                  </View>
                  {!mailboxes.some((m) => m.status === "connected") && (
                    <Button
                      label="Connect a sending email account"
                      t={t}
                      onPress={() => {
                        setCompose(null);
                        onEmailAccounts();
                      }}
                    />
                  )}
                  <Text style={text}>
                    Service profile for AI and signature (optional)
                  </Text>
                  <View style={row}>
                    <Button
                      label="No profile"
                      t={t}
                      secondary={!!profileId}
                      onPress={() => setProfileId("")}
                    />
                    {profiles.map((p) => (
                      <Button
                        key={p.id}
                        label={p.name}
                        t={t}
                        secondary={profileId !== p.id}
                        onPress={() => setProfileId(p.id)}
                      />
                    ))}
                  </View>
                  <Button
                    label="Draft application with AI"
                    t={t}
                    secondary
                    disabled={!!busy}
                    onPress={() =>
                      void perform("Drafting application", async () => {
                        const r = await api("upwork-draft", {
                          job_id: compose.job.id,
                          profile_id: profileId || undefined,
                        });
                        setSubject(r.subject);
                        setBody(r.body);
                      })
                    }
                  />
                  <Field
                    label="Application subject"
                    value={subject}
                    onChangeText={setSubject}
                    t={t}
                  />
                  <Field
                    label="Application message"
                    value={body}
                    onChangeText={setBody}
                    t={t}
                    multiline
                  />
                  {!!profileId && (
                    <Text style={muted}>
                      The selected audience profile’s sender name and signature
                      will be attached.
                    </Text>
                  )}
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: confirmed }}
                    accessibilityLabel="Upwork permits me to contact this client outside Upwork"
                    onPress={() => setConfirmed(!confirmed)}
                    style={{ ...row, alignItems: "flex-start" }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderWidth: 1,
                        borderColor: t.border,
                        borderRadius: 5,
                        backgroundColor: confirmed ? t.accent : t.bg,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {confirmed && (
                        <Text style={{ color: t.accentText }}>✓</Text>
                      )}
                    </View>
                    <Text style={{ ...muted, flex: 1 }}>
                      Upwork permits me to contact this client outside Upwork,
                      for example through an active contract or an applicable
                      exception. Finding a public email does not grant
                      permission to contact a client before a contract.
                    </Text>
                  </Pressable>
                  <Link
                    url="https://www.upwork.com/legal"
                    label="Upwork contact information rules"
                    t={t}
                  />
                  <Button
                    label="Send email application"
                    t={t}
                    disabled={
                      !!busy ||
                      !mailboxId ||
                      !subject.trim() ||
                      !body.trim() ||
                      !confirmed
                    }
                    onPress={() =>
                      void perform("Sending application", async () => {
                        const r = await api("upwork-apply", {
                          job_id: compose.job.id,
                          email: compose.email,
                          mailbox_id: mailboxId,
                          profile_id: profileId || undefined,
                          subject,
                          body,
                          permission_confirmed: confirmed,
                        });
                        setCompose(null);
                        setTab("Applications");
                        await refresh();
                        setNotice(
                          r.application.status === "sent"
                            ? "Application accepted by your sending provider."
                            : r.application.error ||
                                "Check application history for the send status.",
                        );
                      })
                    }
                  />
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
