import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  useWindowDimensions,
  Modal,
  Platform,
  Linking,
  ActivityIndicator,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  LayoutDashboard,
  Radar,
  Users,
  Send,
  Mail,
  Settings,
  Sun,
  Moon,
  ArrowUpRight,
  Plus,
  Search,
  ChevronRight,
  ArrowRight,
  Sparkles,
  Target,
  Globe,
  Check,
  Pause,
  Play,
  X,
  LogOut,
  ShieldCheck,
  Clock,
  Folder,
  ExternalLink,
  CheckCircle2,
  Menu,
  AlertCircle,
  Download,
} from "lucide-react-native";
import Svg, {
  Circle,
  Line,
  Path,
  Defs,
  LinearGradient,
  Stop,
} from "react-native-svg";
import { Session } from "@supabase/supabase-js";
import { supabase, api } from "./src/supabase";
import { loadWorkspace, persistRow, saveCampaign, saveDemo } from "./src/store";
import {
  Workspace,
  ScoutingProfile,
  Campaign,
  Lead,
  Message,
  uid,
  booleanQuery,
  draftMessages,
  demoWorkspace,
  emptyWorkspace,
  validateMessages,
  renderMessage,
} from "./src/domain";
import { BrandLogo, BrandIcon } from "./src/components/Brand";
import { EmailVerificationControl } from "./src/components/EmailVerificationControl";
import { emailProblem } from "./src/email-verification";
import { PoolSearch } from "./src/components/PoolSearch";
import { demoPool, poolLead, type PoolProspect, type ProspectKind } from "./src/prospect-pool";
import { LandingPage } from "./src/components/LandingPage";
import { entryIntent, viewUrl, type EntryView } from "./src/navigation";
const startupIntent = () =>
  entryIntent(
    Platform.OS,
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.location.href
      : undefined,
  );
const dark = {
  bg: "#0A100F",
  panel: "#111A17",
  raised: "#18231F",
  border: "#25322B",
  text: "#EFF5ED",
  muted: "#8B9C91",
  accent: "#C0F580",
  accentText: "#14200D",
  soft: "#243724",
  blue: "#9FB8F1",
  danger: "#E99482",
};
const light = {
  bg: "#F5F6F1",
  panel: "#FFFFFF",
  raised: "#EDF1E8",
  border: "#DDE3D8",
  text: "#16251D",
  muted: "#718071",
  accent: "#254C32",
  accentText: "#F4FFE9",
  soft: "#E5F0DA",
  blue: "#5274A7",
  danger: "#A43826",
};
type Theme = typeof dark;
const nav = [
  ["Overview", LayoutDashboard],
  ["AI Scouting", Radar],
  ["Search", Search],
  ["Audience lists", Users],
  ["Campaigns", Send],
  ["Email accounts", Mail],
] as const;
const UIContext: React.Context<any> = React.createContext<any>({});
const T = ({ children, style, ...props }: any): React.ReactElement => {
  const { s } = React.useContext(UIContext);
  return (
    <Text {...props} style={[s.text, style]}>
      {children}
    </Text>
  );
};
const Btn = ({
  children,
  onPress,
  icon: Icon = ArrowRight,
  secondary = false,
  disabled = false,
}: any): React.ReactElement => {
  const { s, t, busy } = React.useContext(UIContext);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || !!busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        secondary && s.secondary,
        { opacity: disabled || busy?.length ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      <T
        style={{
          color: secondary ? t.text : t.accentText,
          fontWeight: "700",
          fontSize: 13,
        }}
      >
        {children}
      </T>
      {Icon && <Icon size={16} color={secondary ? t.text : t.accentText} />}
    </Pressable>
  );
};
const Input = ({
  label,
  value,
  onChangeText,
  multiline = false,
  placeholder = "",
  ...props
}: any): React.ReactElement => {
  const { s, t } = React.useContext(UIContext);
  return (
    <View style={{ gap: 8, marginBottom: 18 }}>
      <T style={s.label}>{label}</T>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        multiline={multiline}
        style={[
          s.input,
          multiline && { minHeight: 100, textAlignVertical: "top" },
        ]}
        {...props}
      />
    </View>
  );
};
const Badge = ({ children, color }: any): React.ReactElement => {
  const { s, t } = React.useContext(UIContext);
  color = color || t.accent;
  return (
    <View
      style={[
        s.badge,
        { borderColor: color + "30", backgroundColor: color + "12" },
      ]}
    >
      <View
        style={{ width: 5, height: 5, borderRadius: 5, backgroundColor: color }}
      />
      <T style={{ fontSize: 10, color, fontWeight: "600" }}>{children}</T>
    </View>
  );
};

export default function App(): React.ReactElement {
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const [night, setNight] = useState(true);
  const [siteView, setSiteView] = useState<EntryView>(
    () => startupIntent().view,
  );
  const [authReady, setAuthReady] = useState(false);
  const t = night ? dark : light;
  const s = styles(t, compact);
  const [page, setPage] = useState("Overview");
  const [menu, setMenu] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>(demoWorkspace());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState<
    "auth" | "profile" | "scout" | "campaign" | null
  >(() => (startupIntent().auth ? "auth" : null));
  const [authMode, setAuthMode] = useState<"signin" | "signup">(
    () => startupIntent().auth || "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState<ScoutingProfile | null>(null);
  const [listName, setListName] = useState("");
  const [scoutKind, setScoutKind] = useState<ProspectKind>("company");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [step, setStep] = useState(0);
  const [verifyingEmails, setVerifyingEmails] = useState<Set<string>>(
    () => new Set(),
  );
  const verificationInFlight = React.useRef(new Set<string>());
  const [verificationErrors, setVerificationErrors] = useState<
    Record<string, string>
  >({});
  const [search, setSearch] = useState("");
  const [selectedList, setSelectedList] = useState("all");
  const loadedKey = React.useRef("");
  const demo = !session;
  const activeProfile = profile || workspace.profiles[0];
  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        if (data.session) {
          setSiteView("workspace");
          setModal((current) => (current === "auth" ? null : current));
        }
        setAuthReady(true);
      })
      .catch(() => setAuthReady(true));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (s && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        setSiteView("workspace");
        setModal((current) => (current === "auth" ? null : current));
      }
      if (event === "SIGNED_OUT" && Platform.OS === "web") {
        setSiteView("landing");
        window.history.replaceState(
          {},
          "",
          viewUrl(window.location.href, "landing"),
        );
      }
    });
    AsyncStorage.getItem("aisas.theme").then(
      (v) => v && setNight(v === "dark"),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let valid = true;
    loadedKey.current = "";
    setLoading(true);
    setError("");
    (session
      ? loadWorkspace()
      : AsyncStorage.getItem("aisas.demo.v1").then((v) =>
          v ? JSON.parse(v) : demoWorkspace(),
        )
    )
      .then((w) => {
        if (valid) {
          loadedKey.current = session?.user.id || "demo";
          setWorkspace(w);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => valid && setLoading(false));
    return () => {
      valid = false;
    };
  }, [session?.user.id]);
  useEffect(() => {
    if (demo && !loading && loadedKey.current === "demo")
      saveDemo(workspace).catch(() => {});
  }, [workspace, loading, demo]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const u = new URL(window.location.href);
      if (u.searchParams.has("mailbox_error")) {
        setError(
          "Mailbox setup was not completed. Check your email provider settings and try connecting again.",
        );
        setPage("Email accounts");
        window.history.replaceState({}, "", window.location.pathname);
      }
      if (u.searchParams.has("mailbox_connected")) {
        setNotice("Email account connected.");
        setPage("Email accounts");
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, []);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const navigate = () => {
      const intent = startupIntent();
      setSiteView(intent.view);
      if (intent.auth) {
        setAuthMode(intent.auth);
        setModal("auth");
      }
    };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);
  function showView(view: EntryView) {
    setSiteView(view);
    setMenu(false);
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const next = viewUrl(window.location.href, view);
      if (
        next !==
        window.location.pathname + window.location.search + window.location.hash
      )
        window.history.pushState({}, "", next);
    }
  }
  function openAuth(mode: "signup" | "signin") {
    setError("");
    setNotice("");
    setAuthMode(mode);
    setModal("auth");
  }
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setBusy("");
    }
  }
  function go(p: string) {
    setPage(p);
    setSearch("");
    setMenu(false);
  }
  function toggleTheme() {
    setNight(!night);
    AsyncStorage.setItem("aisas.theme", night ? "light" : "dark");
  }
  function newProfile() {
    setProfile({
      id: uid(),
      name: "",
      audience: "",
      location: "",
      niche: "",
      sub_niche: "",
      usp: "",
      offer: "",
    });
    setModal("profile");
  }
  async function storeProfile() {
    if (!profile || Object.values(profile).some((v) => !v.trim()))
      throw new Error(
        "Complete every field to give your scout the right context.",
      );
    if (!demo) await persistRow("scouting_profiles", profile);
    setWorkspace((w) => ({
      ...w,
      profiles: [profile, ...w.profiles.filter((p) => p.id !== profile.id)],
    }));
    setModal(null);
    setNotice("Audience profile saved. Ready to scout.");
  }
  function newCampaign() {
    setStep(0);
    setCampaign({
      id: uid(),
      name: "",
      list_id: workspace.lists[0]?.id || "",
      profile_id: workspace.profiles[0]?.id || "",
      mailbox_id: workspace.mailboxes[0]?.id || "",
      status: "draft",
      start_at: "",
      messages: workspace.profiles[0]
        ? draftMessages(workspace.profiles[0])
        : [],
      approved: false,
      sent: 0,
    });
    setModal("campaign");
  }
  async function storeCampaign() {
    if (!campaign?.name.trim()) throw new Error("Give your campaign a name.");
    if (!campaign.list_id || !campaign.profile_id)
      throw new Error("Choose an audience list and a service profile.");
    if (!validateMessages(campaign.messages))
      throw new Error(
        "Complete all four messages. Follow-up delays must be whole hours from 1 to 720.",
      );
    if (campaign.start_at && Number.isNaN(Date.parse(campaign.start_at)))
      throw new Error("Enter a valid start date with timezone.");
    if (!demo) await saveCampaign(campaign);
    setWorkspace((w) => ({
      ...w,
      campaigns: [campaign, ...w.campaigns.filter((c) => c.id !== campaign.id)],
    }));
    setModal(null);
    setNotice("Campaign saved. Review and approve before launch.");
  }
  async function scout() {
    if (!activeProfile) throw new Error("Create a scouting profile first.");
    if (!listName.trim())
      throw new Error("Name the list where results will be saved.");
    if (demo) {
      const sample = demoWorkspace();
      const demoLeads = scoutKind === "person" ? demoPool().filter(p => p.prospect_kind === "person").map(p => poolLead(p,"",uid())) : sample.leads;
      const list = {
        id: uid(),
        name: listName.trim(),
        created_at: new Date().toISOString(),
      };
      setWorkspace((w) => ({
        ...w,
        lists: [list, ...w.lists],
        leads: [
          ...demoLeads.map((l) => ({
            ...l,
            id: uid(),
            list_id: list.id,
            location: activeProfile.location,
          })),
          ...w.leads,
        ],
      }));
      setNotice(
        `Demo scouting complete: ${demoLeads.length} sample leads saved. No live search was performed.`,
      );
    } else {
      const data = await api("scout", {
        profile_id: activeProfile.id,
        list_name: listName,
        prospect_kind: scoutKind,
      });
      setWorkspace(await loadWorkspace());
      setNotice(`${data.count} leads saved from available search results.`);
    }
    setModal(null);
    go("Audience lists");
  }
  async function savePoolProspects(rows: PoolProspect[], listId: string | null, name: string) {
    if (demo) {
      const destination = listId || uid();
      const existing = workspace.leads.filter(l => l.list_id === destination);
      const fresh = rows.filter(p => !existing.some(l => l.pool_prospect_id === p.id ||
        (l.company.toLowerCase() === p.company.toLowerCase() && l.contact_name.toLowerCase() === p.contact_name.toLowerCase() && l.email.toLowerCase() === p.email.toLowerCase())));
      setWorkspace(w => ({...w,
        lists: listId ? w.lists : [{id:destination,name,created_at:new Date().toISOString()},...w.lists],
        leads: [...fresh.map(p => poolLead(p,destination,uid())),...w.leads],
      }));
      return {list_id:destination,added:fresh.length,skipped:rows.length-fresh.length};
    }
    const result = await supabase.rpc("aisas_save_pool_prospects", {
      p_ids: rows.map(p => p.id), p_list_id: listId, p_list_name: listId ? null : name,
    });
    if (result.error) throw new Error("Could not save to that audience list. Refresh and try again.");
    setWorkspace(await loadWorkspace());
    return result.data;
  }
  async function campaignAction(c: Campaign) {
    if (c.status === "running" || c.status === "scheduled") {
      if (!demo) {
        await api("campaign-status", { campaign_id: c.id, status: "paused" });
      }
      setWorkspace((w) => ({
        ...w,
        campaigns: w.campaigns.map((x) =>
          x.id === c.id ? { ...x, status: "paused" } : x,
        ),
      }));
      return;
    }
    if (!c.approved)
      throw new Error(
        "Open the campaign and approve all four messages before launch.",
      );
    if (!demo) {
      await api("campaign-status", { campaign_id: c.id, status: "running" });
      setWorkspace(await loadWorkspace());
    } else {
      setWorkspace((w) => ({
        ...w,
        campaigns: w.campaigns.map((x) =>
          x.id === c.id ? { ...x, status: "running" } : x,
        ),
      }));
      setNotice("Demo campaign started. No emails will be sent.");
    }
  }
  async function auth() {
    if (!email || password.length < 8)
      throw new Error(
        "Enter your email and a password of at least 8 characters.",
      );
    const { error } =
      authMode === "signup"
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setPassword("");
    setModal(null);
    setNotice(
      authMode === "signup"
        ? "Account created. Check your email to confirm your address."
        : "Welcome back.",
    );
  }
  async function connectMailbox(provider: string) {
    if (demo) {
      setModal("auth");
      setNotice("Sign in to securely connect a real email account.");
      return;
    }
    const { url } = await api("connect-mailbox", { provider });
    await Linking.openURL(url);
  }
  async function verifyLeadEmail(lead: Lead) {
    if (verificationInFlight.current.has(lead.id)) return;
    verificationInFlight.current.add(lead.id);
    setVerifyingEmails(new Set(verificationInFlight.current));
    setVerificationErrors((v) => ({ ...v, [lead.id]: "" }));
    try {
      let fields;
      if (demo) {
        const problem = emailProblem(lead.email);
        fields = {
          email_verification_status: problem
            ? ("invalid" as const)
            : ("unknown" as const),
          email_verification_reason: problem || "demo_no_live_check",
          email_verification_address: lead.email,
          email_verification_provider: "demo",
          email_verification_checked_at: new Date().toISOString(),
        };
      } else {
        const result = await api("verify-email", { lead_id: lead.id });
        const { lead_id, email, ...saved } = result;
        if (email !== lead.email)
          throw new Error(
            "The email address changed. Refresh the list and try again.",
          );
        fields = saved;
      }
      setWorkspace((w) => ({
        ...w,
        leads: w.leads.map((l) =>
          l.id === lead.id && l.email === lead.email ? { ...l, ...fields } : l,
        ),
      }));
    } catch (e: any) {
      setVerificationErrors((v) => ({
        ...v,
        [lead.id]:
          e.message || "Unable to verify this address. Please try again.",
      }));
    } finally {
      verificationInFlight.current.delete(lead.id);
      setVerifyingEmails(new Set(verificationInFlight.current));
    }
  }
  const total = workspace.leads.length;
  const filtered = workspace.leads.filter(
    (l) =>
      (selectedList === "all" || l.list_id === selectedList) &&
      `${l.company} ${l.email} ${l.location}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const choices = (
    label: string,
    items: { id: string; name: string }[],
    value: string,
    onSelect: (id: string) => void,
  ) => (
    <View style={{ marginBottom: 18, gap: 9 }}>
      <T style={s.label}>{label}</T>
      <View style={s.wrap}>
        {items.length ? (
          items.map((i) => (
            <Pressable
              key={i.id}
              onPress={() => onSelect(i.id)}
              style={[
                s.choice,
                value === i.id && {
                  borderColor: t.accent,
                  backgroundColor: t.soft,
                },
              ]}
            >
              <T
                style={{
                  fontSize: 12,
                  color: value === i.id ? t.accent : t.muted,
                }}
              >
                {i.name}
              </T>
            </Pressable>
          ))
        ) : (
          <T style={s.muted}>None yet. Create one first.</T>
        )}
      </View>
    </View>
  );
  const updateMessage = (patch: Partial<Message>) =>
    setCampaign((c) =>
      c
        ? {
            ...c,
            approved: false,
            messages: c.messages.map((m, i) =>
              i === step ? { ...m, ...patch } : m,
            ),
          }
        : c,
    );
  const sequencePreview = workspace.leads.find(
    (l) => l.list_id === campaign?.list_id,
  );
  return (
    <UIContext.Provider value={{ t, s, busy }}>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <View style={s.app}>
            <StatusBar style={night ? "light" : "dark"} />
            {!authReady ? (
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 20,
                }}
              >
                <BrandIcon size={50} />
                <ActivityIndicator color={t.accent} />
              </View>
            ) : siteView === "landing" ? (
              <LandingPage
                night={night}
                authenticated={!!session}
                notice={notice}
                error={error}
                onSignup={() => openAuth("signup")}
                onSignIn={() => openAuth("signin")}
                onDemo={() => showView("workspace")}
                onWorkspace={() => showView("workspace")}
                onToggleTheme={toggleTheme}
                onDismissNotice={() => setNotice("")}
              />
            ) : (
              <>
            {(!compact || menu) && (
              <View
                style={[
                  s.sidebar,
                  compact && {
                    position: "absolute",
                    zIndex: 30,
                    width: 260,
                    height: "100%",
                  },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="AISAS overview"
                  onPress={() => go("Overview")}
                  style={s.brand}
                >
                  <BrandLogo night={night} width={180} accessible={false} />
                </Pressable>
                <T style={s.navLabel}>WORKSPACE</T>
                <View style={{ gap: 7 }}>
                  {nav.map(([label, Icon]) => (
                    <Pressable
                      accessibilityRole="button"
                      key={label}
                      onPress={() => go(label)}
                      style={[s.navItem, page === label && s.navActive]}
                    >
                      <Icon
                        size={18}
                        color={page === label ? t.accent : t.muted}
                      />
                      <T
                        style={{
                          fontSize: 13,
                          color: page === label ? t.text : t.muted,
                          fontWeight: page === label ? "600" : "400",
                        }}
                      >
                        {label}
                      </T>
                      {page === label && <View style={s.activeDot} />}
                    </Pressable>
                  ))}
                </View>
                <View style={{ flex: 1 }} />
                <View style={s.sidebarCard}>
                  <View style={s.row}>
                    <Sparkles size={16} color={t.accent} />
                    <T style={{ fontSize: 12, fontWeight: "600" }}>
                      Your next opportunity
                    </T>
                  </View>
                  <T
                    style={[
                      s.muted,
                      { fontSize: 11, lineHeight: 18, marginTop: 10 },
                    ]}
                  >
                    A sharper audience. A stronger offer. Let intelligence do
                    the scouting.
                  </T>
                  <Pressable
                    onPress={() => {
                      go("AI Scouting");
                    }}
                    style={[s.row, { marginTop: 15 }]}
                  >
                    <T
                      style={{
                        color: t.accent,
                        fontSize: 11,
                        fontWeight: "700",
                      }}
                    >
                      Create a scout
                    </T>
                    <ArrowUpRight size={13} color={t.accent} />
                  </Pressable>
                </View>
                <Pressable style={s.navItem} onPress={() => go("Settings")}>
                  <Settings size={17} color={t.muted} />
                  <T style={s.muted}>Settings</T>
                </Pressable>
                    {Platform.OS === "web" && (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => showView("landing")}
                        style={s.navItem}
                      >
                        <Globe size={17} color={t.muted} />
                        <T style={s.muted}>AISAS website</T>
                      </Pressable>
                    )}
                <View style={s.sidebarUser}>
                  <View style={s.avatar}>
                    <T style={{ fontWeight: "700", color: t.accent }}>CT</T>
                  </View>
                  <View style={{ flex: 1 }}>
                    <T style={{ fontSize: 12, fontWeight: "600" }}>
                      {demo
                        ? "ClemxyTech workspace"
                        : session?.user.email?.split("@")[0]}
                    </T>
                    <T style={{ fontSize: 10, color: t.muted, marginTop: 4 }}>
                      {demo ? "Demo workspace" : "Personal workspace"}
                    </T>
                  </View>
                </View>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <View style={s.topbar}>
                <View style={s.row}>
                  {compact && (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          menu ? "Close navigation" : "Open navigation"
                        }
                        onPress={() => setMenu(!menu)}
                      >
                        <Menu size={20} color={t.text} />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="AISAS overview"
                        onPress={() => go("Overview")}
                      >
                        <BrandIcon size={28} accessible={false} />
                      </Pressable>
                    </>
                  )}
                  {!compact && (
                    <>
                      <T style={{ color: t.muted, fontSize: 12 }}>Workspace</T>
                      <ChevronRight size={12} color={t.muted} />
                    </>
                  )}
                  {(!compact || width >= 520) && (
                    <T style={{ fontSize: 12 }}>{page}</T>
                  )}
                </View>
                <View style={s.row}>
                  <Badge color={demo ? t.blue : t.accent}>
                    {demo ? "DEMO MODE" : "LIVE WORKSPACE"}
                  </Badge>
                  <Pressable
                    accessibilityLabel="Toggle day and night mode"
                    onPress={toggleTheme}
                    style={s.iconButton}
                  >
                    {night ? (
                      <Sun size={17} color={t.muted} />
                    ) : (
                      <Moon size={17} color={t.muted} />
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      demo
                        ? setModal("auth")
                        : run("Signing out", async () => {
                            await supabase.auth.signOut();
                          })
                    }
                    style={s.iconButton}
                  >
                    {demo ? (
                      <T style={{ fontSize: 12, fontWeight: "600" }}>Sign in</T>
                    ) : (
                      <LogOut size={17} color={t.muted} />
                    )}
                  </Pressable>
                </View>
              </View>
              <ScrollView
                contentContainerStyle={s.content}
                keyboardShouldPersistTaps="handled"
              >
                {!!error && (
                  <View
                    accessibilityRole="alert"
                    style={[s.notice, { borderColor: "#D67C68" }]}
                  >
                    <AlertCircle size={18} color="#D67C68" />
                    <T
                      style={{
                        flex: 1,
                        color: "#D67C68",
                        fontSize: 12,
                        lineHeight: 20,
                      }}
                    >
                      {error}
                    </T>
                    <Pressable onPress={() => setError("")}>
                      <X size={16} color={t.muted} />
                    </Pressable>
                  </View>
                )}
                {!!notice && (
                  <View accessibilityRole="alert" style={s.notice}>
                    <CheckCircle2 size={18} color={t.accent} />
                    <T style={{ flex: 1, fontSize: 12, lineHeight: 20 }}>
                      {notice}
                    </T>
                    <Pressable onPress={() => setNotice("")}>
                      <X size={16} color={t.muted} />
                    </Pressable>
                  </View>
                )}
                {loading ? (
                  <ActivityIndicator size="large" color={t.accent} />
                ) : (
                  <>
                    <View style={s.pageHeading}>
                      <View>
                        <View style={[s.row, { marginBottom: 10 }]}>
                          <View style={s.littleLine} />
                          <T style={s.eyebrow}>INTELLIGENCE INTO OPPORTUNITY</T>
                        </View>
                        <T style={s.title}>
                          {page === "Overview"
                            ? "Your growth, on autopilot."
                            : page === "AI Scouting"
                              ? "Find your next opportunity."
                              : page === "Search"
                                ? "Your next audience is already here."
                              : page === "Audience lists"
                                ? "The right people. In one place."
                                : page === "Campaigns"
                                  ? "Conversations that convert."
                                  : page === "Email accounts"
                                    ? "Your outreach command center."
                                    : "Make AISAS yours."}
                        </T>
                        <T style={[s.muted, { marginTop: 10, lineHeight: 21 }]}>
                          {page === "Overview"
                            ? "Discover the right audience. Start meaningful conversations. Grow with purpose."
                            : page === "AI Scouting"
                              ? "Tell us who you serve. Let your scout make the connections."
                              : page === "Search"
                                ? "Find people and companies in the shared prospect pool, then save them to your own lists."
                              : page === "Audience lists"
                                ? "A focused view of every prospect, ready for your next move."
                                : page === "Campaigns"
                                  ? "Personalized value. Thoughtful follow-ups. You stay in control."
                                  : page === "Email accounts"
                                    ? "Connect your mailboxes and choose the right voice for every campaign."
                                    : "Manage your account, appearance, and workspace."}
                        </T>
                      </View>
                      {page === "Overview" ? (
                        <Btn
                          onPress={() => {
                            setProfile(null);
                            setListName("");
                            setModal("scout");
                          }}
                          icon={Plus}
                        >
                          New scout
                        </Btn>
                      ) : page === "Audience lists" ? (
                        <Btn
                          onPress={() => {
                            setProfile(null);
                            setModal("scout");
                          }}
                          icon={Plus}
                        >
                          Build a list
                        </Btn>
                      ) : page === "Campaigns" ? (
                        <Btn onPress={newCampaign} icon={Plus}>
                          New campaign
                        </Btn>
                      ) : null}
                    </View>
                    {page === "Overview" && (
                      <>
                        <View style={s.hero}>
                          <View style={{ flex: 1, zIndex: 2, maxWidth: 520 }}>
                            <Badge>YOUR SCOUT IS READY</Badge>
                            <T style={s.heroTitle}>
                              Less searching.{"\n"}More{" "}
                              <T style={{ color: t.accent, fontWeight: "500" }}>
                                possibility.
                              </T>
                            </T>
                            <T
                              style={{
                                color: t.muted,
                                fontSize: 13,
                                lineHeight: 23,
                                maxWidth: 360,
                                marginBottom: 24,
                              }}
                            >
                              Turn your ideal audience into your next great
                              conversation. Built around your niche, your offer,
                              your edge.
                            </T>
                            <View style={s.row}>
                              <Btn
                                onPress={() => {
                                  setProfile(null);
                                  setListName("");
                                  setModal("scout");
                                }}
                                icon={Radar}
                              >
                                Launch AI scout
                              </Btn>
                              <Pressable
                                onPress={() => go("AI Scouting")}
                                style={[s.row, { padding: 10 }]}
                              >
                                <T style={{ fontSize: 12 }}>Explore profiles</T>
                                <ArrowUpRight size={15} color={t.muted} />
                              </Pressable>
                            </View>
                          </View>
                          {!compact && (
                            <View style={s.radarWrap}>
                              <RadarArt color={t.accent} muted={t.border} />
                              <View style={s.radarFloat}>
                                <View
                                  style={[s.avatar, { width: 30, height: 30 }]}
                                >
                                  <Target size={15} color={t.accent} />
                                </View>
                                <View>
                                  <T
                                    style={{ fontSize: 11, fontWeight: "600" }}
                                  >
                                    Opportunity detected
                                  </T>
                                  <T
                                    style={{
                                      fontSize: 10,
                                      color: t.muted,
                                      marginTop: 3,
                                    }}
                                  >
                                    Your next connection is out there.
                                  </T>
                                </View>
                              </View>
                              <T
                                style={{
                                  position: "absolute",
                                  bottom: 5,
                                  right: 25,
                                  fontSize: 9,
                                  letterSpacing: 2,
                                  color: t.muted,
                                }}
                              >
                                SCOUTING INTELLIGENCE / 01
                              </T>
                            </View>
                          )}
                        </View>
                        <View style={s.metrics}>
                          {[
                            {
                              label: "Prospects discovered",
                              value: total,
                              icon: Users,
                              sub: demo
                                ? "Sample prospects in your workspace"
                                : "Across all your audience lists",
                            },
                            {
                              label: "Audience lists",
                              value: workspace.lists.length,
                              icon: Folder,
                              sub: "Organized around your next move",
                            },
                            {
                              label: "Active campaigns",
                              value: workspace.campaigns.filter((c) =>
                                ["running", "scheduled"].includes(c.status),
                              ).length,
                              icon: Send,
                              sub: `${workspace.campaigns.length} total campaigns`,
                            },
                            {
                              label: "Connected mailboxes",
                              value: workspace.mailboxes.length,
                              icon: Mail,
                              sub: "Your channels for conversation",
                            },
                          ].map((m) => (
                            <View key={m.label} style={s.metric}>
                              <View style={s.between}>
                                <T style={{ fontSize: 11, color: t.muted }}>
                                  {m.label}
                                </T>
                                <m.icon size={17} color={t.muted} />
                              </View>
                              <T
                                style={{
                                  fontSize: 32,
                                  fontWeight: "500",
                                  marginTop: 20,
                                  letterSpacing: -1,
                                }}
                              >
                                {String(m.value).padStart(2, "0")}
                              </T>
                              <T
                                style={{
                                  fontSize: 10,
                                  color: t.muted,
                                  marginTop: 10,
                                }}
                              >
                                {m.sub}
                              </T>
                            </View>
                          ))}
                        </View>
                        <View style={s.twoCols}>
                          <View style={[s.card, { flex: 1.65 }]}>
                            <View style={s.sectionHead}>
                              <View>
                                <T style={s.sectionTitle}>
                                  Your scouting pipeline
                                </T>
                                <T
                                  style={[
                                    s.muted,
                                    { fontSize: 11, marginTop: 6 },
                                  ]}
                                >
                                  From first discovery to first conversation.
                                </T>
                              </View>
                              <View style={s.tinyPill}>
                                <T style={{ fontSize: 10, color: t.muted }}>
                                  WORKFLOW
                                </T>
                              </View>
                            </View>
                            <View
                              style={[
                                s.row,
                                {
                                  alignItems: "stretch",
                                  marginTop: 25,
                                  gap: compact ? 10 : 24,
                                },
                              ]}
                            >
                              {[
                                {
                                  n: "01",
                                  name: "Discover",
                                  text: "Define your ideal audience",
                                  icon: Radar,
                                },
                                {
                                  n: "02",
                                  name: "Organize",
                                  text: "Build focused lead lists",
                                  icon: Users,
                                },
                                {
                                  n: "03",
                                  name: "Connect",
                                  text: "Lead with your value",
                                  icon: Send,
                                },
                              ].map((v, i) => (
                                <Pressable
                                  key={v.n}
                                  onPress={() =>
                                    go(
                                      [
                                        "AI Scouting",
                                        "Audience lists",
                                        "Campaigns",
                                      ][i],
                                    )
                                  }
                                  style={{ flex: 1, gap: 13 }}
                                >
                                  <View style={s.workflowIcon}>
                                    <v.icon color={t.accent} size={21} />
                                  </View>
                                  <T style={{ fontSize: 10, color: t.muted }}>
                                    STEP {v.n}
                                  </T>
                                  <T
                                    style={{ fontSize: 15, fontWeight: "600" }}
                                  >
                                    {v.name}
                                  </T>
                                  <T
                                    style={{
                                      fontSize: 11,
                                      color: t.muted,
                                      lineHeight: 18,
                                    }}
                                  >
                                    {v.text}
                                  </T>
                                </Pressable>
                              ))}
                            </View>
                          </View>
                          <View style={[s.card, { flex: 1 }]}>
                            <View style={s.between}>
                              <T style={s.sectionTitle}>
                                Your unfair advantage
                              </T>
                              <Sparkles size={17} color={t.accent} />
                            </View>
                            <T
                              style={{
                                fontSize: 17,
                                lineHeight: 27,
                                marginTop: 24,
                                marginBottom: 16,
                              }}
                            >
                              {workspace.profiles[0]?.usp ||
                                "A clear value proposition is where every great campaign begins."}
                            </T>
                            <View style={s.divider} />
                            <Pressable
                              onPress={() => {
                                if (workspace.profiles[0]) {
                                  setProfile(workspace.profiles[0]);
                                  setModal("profile");
                                } else newProfile();
                              }}
                              style={[s.between, { marginTop: 16 }]}
                            >
                              <T style={{ fontSize: 11, color: t.accent }}>
                                Refine your service profile
                              </T>
                              <ArrowUpRight size={16} color={t.accent} />
                            </Pressable>
                          </View>
                        </View>
                        <View style={s.card}>
                          <View style={s.sectionHead}>
                            <View style={s.row}>
                              <T style={s.sectionTitle}>Latest discoveries</T>
                              <Badge color={t.blue}>
                                {demo ? "SAMPLE DATA" : `${total} PROSPECTS`}
                              </Badge>
                            </View>
                            <Pressable
                              style={s.row}
                              onPress={() => go("Audience lists")}
                            >
                              <T style={{ fontSize: 11, color: t.muted }}>
                                View all prospects
                              </T>
                              <ArrowUpRight size={14} color={t.muted} />
                            </Pressable>
                          </View>
                          {workspace.leads.slice(0, 4).map((l, i) => (
                            <LeadRow
                              onVerify={() => verifyLeadEmail(l)}
                              verifying={verifyingEmails.has(l.id)}
                              verificationError={verificationErrors[l.id]}
                              key={l.id}
                              lead={l}
                              index={i}
                              t={t}
                              compact={compact}
                              onPress={() => {
                                setSelectedList(l.list_id);
                                go("Audience lists");
                              }}
                            />
                          ))}
                          {!total && (
                            <Empty
                              title="Your next discovery starts here"
                              body="Create a scout to find businesses that fit your audience."
                              t={t}
                            />
                          )}
                        </View>
                      </>
                    )}
                    {page === "AI Scouting" && (
                      <>
                        <View style={[s.twoCols, { alignItems: "stretch" }]}>
                          <View style={[s.card, { flex: 1.5 }]}>
                            <Badge>PRECISION SCOUTING</Badge>
                            <T
                              style={[
                                s.heroTitle,
                                { fontSize: 30, marginTop: 24 },
                              ]}
                            >
                              Good growth starts with{"\n"}the right audience.
                            </T>
                            <T
                              style={[
                                s.muted,
                                { lineHeight: 24, marginBottom: 25 },
                              ]}
                            >
                              Define the businesses you want to reach, then
                              bring your service, unique proposition, and offer
                              into focus.
                            </T>
                            <Btn onPress={newProfile} icon={Plus}>
                              Create audience profile
                            </Btn>
                          </View>
                          <View style={[s.card, { flex: 1 }]}>
                            <View style={s.row}>
                              <Globe color={t.accent} size={19} />
                              <T style={s.sectionTitle}>Search, with intent.</T>
                            </View>
                            <T
                              style={[
                                s.muted,
                                { lineHeight: 24, marginTop: 20 },
                              ]}
                            >
                              Boolean queries search the web, directories,
                              LinkedIn, blogs, and Google Maps through
                              configured search providers.
                            </T>
                            <View style={[s.code, { marginTop: 20 }]}>
                              <T
                                style={{
                                  color: t.accent,
                                  fontSize: 11,
                                  lineHeight: 20,
                                  fontFamily:
                                    Platform.OS === "ios"
                                      ? "Menlo"
                                      : "monospace",
                                }}
                              >
                                {booleanQuery(
                                  workspace.profiles[0] || {
                                    audience: "Your audience",
                                    location: "Your location",
                                  },
                                )}
                              </T>
                            </View>
                            <T
                              style={{
                                color: t.muted,
                                fontSize: 10,
                                lineHeight: 18,
                                marginTop: 14,
                              }}
                            >
                              Only contacts available in source results are
                              captured. Missing fields stay blank.
                            </T>
                          </View>
                        </View>
                        <View style={s.sectionHead}>
                          <T style={s.sectionTitle}>
                            Audience & service profiles
                          </T>
                          <T style={s.muted}>
                            {workspace.profiles.length} profiles
                          </T>
                        </View>
                        <View style={s.wrap}>
                          {workspace.profiles.map((p) => (
                            <View
                              key={p.id}
                              style={[
                                s.card,
                                {
                                  width: compact ? "100%" : undefined,
                                  flexBasis: compact ? undefined : "48%",
                                  flexGrow: 1,
                                },
                              ]}
                            >
                              <View style={s.between}>
                                <View style={s.workflowIcon}>
                                  <Target color={t.accent} size={21} />
                                </View>
                                <Pressable
                                  onPress={() => {
                                    setProfile(p);
                                    setModal("profile");
                                  }}
                                >
                                  <T style={{ fontSize: 11, color: t.muted }}>
                                    Edit profile ↗
                                  </T>
                                </Pressable>
                              </View>
                              <T style={[s.sectionTitle, { marginTop: 20 }]}>
                                {p.name}
                              </T>
                              <T style={[s.muted, { marginTop: 8 }]}>
                                {p.audience} · {p.location}
                              </T>
                              <View style={[s.wrap, { marginTop: 16 }]}>
                                <View style={s.tinyPill}>
                                  <T style={{ color: t.muted, fontSize: 10 }}>
                                    {p.niche}
                                  </T>
                                </View>
                                <View style={s.tinyPill}>
                                  <T style={{ color: t.muted, fontSize: 10 }}>
                                    {p.sub_niche}
                                  </T>
                                </View>
                              </View>
                              <T
                                style={{
                                  fontSize: 12,
                                  lineHeight: 22,
                                  marginVertical: 20,
                                }}
                              >
                                {p.usp}
                              </T>
                              <Btn
                                secondary
                                onPress={() => {
                                  setProfile(p);
                                  setListName(`${p.audience} · ${p.location}`);
                                  setModal("scout");
                                }}
                                icon={Radar}
                              >
                                Scout this audience
                              </Btn>
                            </View>
                          ))}
                        </View>
                        {!workspace.profiles.length && (
                          <Empty
                            title="Define your first audience"
                            body="Your profile helps AISAS search with purpose and write with context."
                            t={t}
                          />
                        )}
                      </>
                    )}
                    {page === "Search" && (
                      <PoolSearch key={session?.user.id || "demo"} t={t} demo={demo} lists={workspace.lists}
                        onSave={savePoolProspects}
                        onOpenList={(id) => { setSelectedList(id); go("Audience lists"); }}
                        onScout={() => { setScoutKind("company"); setModal("scout"); }}
                        onSignIn={() => openAuth("signin")}
                      />
                    )}
                    {page === "Audience lists" && (
                      <>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          style={{ marginBottom: 24 }}
                          contentContainerStyle={{ gap: 10 }}
                        >
                          {[
                            { id: "all", name: "All prospects" },
                            ...workspace.lists,
                          ].map((l) => (
                            <Pressable
                              key={l.id}
                              onPress={() => setSelectedList(l.id)}
                              style={[
                                s.choice,
                                selectedList === l.id && {
                                  borderColor: t.accent,
                                  backgroundColor: t.soft,
                                },
                              ]}
                            >
                              <T
                                style={{
                                  fontSize: 12,
                                  color:
                                    selectedList === l.id ? t.accent : t.muted,
                                }}
                              >
                                {l.name}{" "}
                                <T style={{ color: t.muted }}>
                                  {" "}
                                  {
                                    workspace.leads.filter(
                                      (x) =>
                                        l.id === "all" || x.list_id === l.id,
                                    ).length
                                  }
                                </T>
                              </T>
                            </Pressable>
                          ))}
                        </ScrollView>
                        <View style={s.card}>
                          <View style={s.sectionHead}>
                            <View>
                              <T style={s.sectionTitle}>
                                {workspace.lists.find(
                                  (l) => l.id === selectedList,
                                )?.name || "All prospects"}
                              </T>
                              <T
                                style={[
                                  s.muted,
                                  { fontSize: 11, marginTop: 6 },
                                ]}
                              >
                                {filtered.length} prospects{" "}
                                {demo ? "· Demonstration data" : ""}
                              </T>
                            </View>
                            <View style={[s.row, s.searchBox]}>
                              <Search size={15} color={t.muted} />
                              <TextInput
                                accessibilityLabel="Search prospects"
                                value={search}
                                onChangeText={setSearch}
                                placeholder="Search prospects"
                                placeholderTextColor={t.muted}
                                style={{
                                  color: t.text,
                                  fontSize: 12,
                                  width: compact ? 100 : 180,
                                  padding: 5,
                                }}
                              />
                            </View>
                          </View>
                          <View
                            style={[
                              s.between,
                              {
                                paddingVertical: 12,
                                borderBottomWidth: 1,
                                borderColor: t.border,
                              },
                            ]}
                          >
                            <T style={s.eyebrow}>BUSINESS / LOCATION</T>
                            {!compact && (
                              <T style={s.eyebrow}>AVAILABLE CONTACT DETAILS</T>
                            )}
                            <T style={s.eyebrow}>CONTACT SCORE</T>
                          </View>
                          {filtered.map((l, i) => (
                            <View key={l.id}>
                              <LeadRow
                                onVerify={() => verifyLeadEmail(l)}
                                verifying={verifyingEmails.has(l.id)}
                                verificationError={verificationErrors[l.id]}
                                lead={l}
                                index={i}
                                compact={compact}
                                t={t}
                              />
                              <View
                                style={[
                                  s.wrap,
                                  {
                                    paddingLeft: compact ? 0 : 50,
                                    paddingBottom: 14,
                                    marginTop: -3,
                                    gap: 14,
                                  },
                                ]}
                              >
                                {[
                                  { label: l.phone, url: `tel:${l.phone}` },
                                  {
                                    label: l.website ? "Website" : "",
                                    url: l.website,
                                  },
                                  {
                                    label: l.linkedin ? "LinkedIn" : "",
                                    url: l.linkedin,
                                  },
                                  {
                                    label: l.source_url ? "View source" : "",
                                    url: l.source_url,
                                  },
                                ]
                                  .filter((x) => x.label)
                                  .map((x) => (
                                    <Pressable
                                      accessibilityRole="link"
                                      key={x.url}
                                      onPress={() => Linking.openURL(x.url)}
                                    >
                                      <T
                                        style={{ fontSize: 10, color: t.blue }}
                                      >
                                        {x.label} ↗
                                      </T>
                                    </Pressable>
                                  ))}
                              </View>
                            </View>
                          ))}
                          {!filtered.length && (
                            <Empty
                              title="No matching prospects yet"
                              body="Launch a scout or try a different search."
                              t={t}
                            />
                          )}
                        </View>
                      </>
                    )}
                    {page === "Campaigns" && (
                      <>
                        <View style={[s.notice, { marginBottom: 24 }]}>
                          <ShieldCheck size={19} color={t.accent} />
                          <T
                            style={{
                              fontSize: 12,
                              color: t.muted,
                              flex: 1,
                              lineHeight: 20,
                            }}
                          >
                            Every sequence starts with your approval. One first
                            message, three thoughtful follow-ups, and a pace you
                            control.
                          </T>
                        </View>
                        {workspace.campaigns.map((c) => (
                          <View
                            style={[s.card, { marginBottom: 16 }]}
                            key={c.id}
                          >
                            <View style={s.sectionHead}>
                              <View style={s.row}>
                                <View style={s.workflowIcon}>
                                  <Send size={20} color={t.accent} />
                                </View>
                                <View>
                                  <T style={s.sectionTitle}>{c.name}</T>
                                  <T
                                    style={{
                                      fontSize: 11,
                                      color: t.muted,
                                      marginTop: 7,
                                    }}
                                  >
                                    {workspace.lists.find(
                                      (l) => l.id === c.list_id,
                                    )?.name || "Choose a list"}
                                  </T>
                                </View>
                              </View>
                              <Badge
                                color={
                                  c.status === "running" ? t.accent : t.blue
                                }
                              >
                                {c.status.toUpperCase()}
                              </Badge>
                            </View>
                            <View
                              style={[s.wrap, { gap: 24, marginVertical: 20 }]}
                            >
                              <T style={s.muted}>
                                {
                                  workspace.leads.filter(
                                    (l) => l.list_id === c.list_id,
                                  ).length
                                }{" "}
                                recipients
                              </T>
                              <T style={s.muted}>4-message sequence</T>
                              <T style={s.muted}>
                                {c.approved
                                  ? "Messages approved"
                                  : "Awaiting review"}
                              </T>
                              <T style={s.muted}>
                                {c.start_at
                                  ? new Date(c.start_at).toLocaleString()
                                  : "Start when launched"}
                              </T>
                            </View>
                            <View style={s.divider} />
                            <View style={[s.between, { marginTop: 20 }]}>
                              <T style={{ fontSize: 11, color: t.muted }}>
                                {workspace.mailboxes.find(
                                  (m) => m.id === c.mailbox_id,
                                )?.email || "No sending account selected"}
                              </T>
                              <View style={s.row}>
                                <Btn
                                  disabled={
                                    !["draft", "paused"].includes(c.status)
                                  }
                                  secondary
                                  icon={null}
                                  onPress={() => {
                                    setCampaign(c);
                                    setStep(0);
                                    setModal("campaign");
                                  }}
                                >
                                  Edit sequence
                                </Btn>
                                <Btn
                                  icon={
                                    ["running", "scheduled"].includes(c.status)
                                      ? Pause
                                      : Play
                                  }
                                  onPress={() =>
                                    run("Updating campaign", () =>
                                      campaignAction(c),
                                    )
                                  }
                                >
                                  {["running", "scheduled"].includes(c.status)
                                    ? "Pause"
                                    : c.status === "paused"
                                      ? "Restart"
                                      : "Launch"}
                                </Btn>
                              </View>
                            </View>
                          </View>
                        ))}
                        {!workspace.campaigns.length && (
                          <Empty
                            title="Start a meaningful conversation"
                            body="Build your first campaign from an audience list and service profile."
                            t={t}
                          />
                        )}
                      </>
                    )}
                    {page === "Email accounts" && (
                      <>
                        <View style={[s.hero, { minHeight: 200 }]}>
                          <View style={{ flex: 1 }}>
                            <Badge>CONNECTED BY YOU</Badge>
                            <T
                              style={{
                                fontSize: 27,
                                fontWeight: "500",
                                marginTop: 20,
                                marginBottom: 13,
                              }}
                            >
                              One workspace. Every inbox.
                            </T>
                            <T
                              style={[
                                s.muted,
                                { lineHeight: 23, maxWidth: 580 },
                              ]}
                            >
                              Connect Gmail, Outlook, Yahoo, or your
                              custom-domain mailbox. For custom domains, you
                              provide your own incoming IMAP and outgoing SMTP
                              settings during setup.
                            </T>
                          </View>
                          <Mail size={70} color={t.accent} />
                        </View>
                        <T
                          style={[
                            s.muted,
                            { lineHeight: 22, marginBottom: 20 },
                          ]}
                        >
                          Mailbox connections are for campaign delivery. Your
                          AISAS account uses email and password.
                        </T>
                        <View style={s.wrap}>
                          {[
                            {
                              name: "Gmail",
                              provider: "google",
                              letter: "G",
                              color: "#D9826F",
                            },
                            {
                              name: "Outlook",
                              provider: "microsoft",
                              letter: "O",
                              color: "#73A8EF",
                            },
                            {
                              name: "Yahoo",
                              provider: "yahoo",
                              letter: "Y",
                              color: "#AD8EE8",
                            },
                            {
                              name: "Custom domain email",
                              provider: "imap",
                              letter: "@",
                              color: t.accent,
                            },
                          ].map((m) => (
                            <View
                              key={m.provider}
                              style={[
                                s.card,
                                { flex: 1, minWidth: compact ? 140 : 180 },
                              ]}
                            >
                              <T
                                style={{
                                  fontSize: 31,
                                  fontWeight: "700",
                                  color: m.color,
                                  marginBottom: 24,
                                }}
                              >
                                {m.letter}
                              </T>
                              <T style={s.sectionTitle}>{m.name}</T>
                              <T
                                style={{
                                  fontSize: 11,
                                  lineHeight: 20,
                                  color: t.muted,
                                  marginTop: 9,
                                  marginBottom: 24,
                                }}
                              >
                                {m.provider === "imap"
                                  ? "Use your own IMAP and SMTP settings."
                                  : "Connect with secure authorization."}
                              </T>
                              <Btn
                                secondary
                                icon={Plus}
                                onPress={() =>
                                  run("Connecting account", () =>
                                    connectMailbox(m.provider),
                                  )
                                }
                              >
                                Connect
                              </Btn>
                            </View>
                          ))}
                        </View>
                        <View style={[s.card, { marginTop: 24 }]}>
                          <T style={s.sectionTitle}>Connected accounts</T>
                          {workspace.mailboxes.map((m) => (
                            <View
                              key={m.id}
                              style={[s.between, { paddingVertical: 20 }]}
                            >
                              <View style={s.row}>
                                <Mail size={18} color={t.accent} />
                                <T>{m.email}</T>
                              </View>
                              <Badge>{m.status}</Badge>
                            </View>
                          ))}
                          {!workspace.mailboxes.length && (
                            <Empty
                              title="Your first inbox belongs here"
                              body="Connect an account above. Each user connects their own mailbox. Custom-domain IMAP/SMTP settings are entered securely with Nylas, never stored on your device."
                              t={t}
                            />
                          )}
                        </View>
                      </>
                    )}
                    {page === "Settings" && (
                      <View style={s.card}>
                        <View
                          style={{
                            backgroundColor: t.bg,
                            padding: 16,
                            borderRadius: 8,
                            marginBottom: 24,
                          }}
                        >
                          <BrandLogo
                            night={night}
                            width={compact ? 180 : 240}
                          />
                        </View>
                        <T style={s.sectionTitle}>Workspace preferences</T>
                        <View style={[s.between, { paddingVertical: 28 }]}>
                          <View>
                            <T>Appearance</T>
                            <T style={[s.muted, { marginTop: 6 }]}>
                              Intelligence, in a different light.
                            </T>
                          </View>
                          <Btn
                            secondary
                            icon={night ? Sun : Moon}
                            onPress={toggleTheme}
                          >
                            {night ? "Day mode" : "Night mode"}
                          </Btn>
                        </View>
                        <View style={s.divider} />
                        <View style={[s.between, { paddingVertical: 28 }]}>
                          <View>
                            <T>Account</T>
                            <T style={[s.muted, { marginTop: 6 }]}>
                              {session?.user.email ||
                                "You’re exploring the demo workspace."}
                            </T>
                          </View>
                          <Btn
                            secondary
                            onPress={() =>
                              demo
                                ? setModal("auth")
                                : run("Signing out", async () => {
                                    await supabase.auth.signOut();
                                  })
                            }
                          >
                            {demo ? "Create account" : "Sign out"}
                          </Btn>
                        </View>
                        <View style={s.divider} />
                        <T
                          style={{
                            color: t.muted,
                            fontSize: 11,
                            lineHeight: 22,
                            marginTop: 20,
                          }}
                        >
                          AISAS By ClemxyTech · Version 0.1.0{"\n"}One
                          TypeScript application for web, Android, and iOS.
                          {"\n"}
                          {demo
                            ? "Demo changes are saved on this device. Sign in for your own secure workspace."
                            : "Your records are protected by per-user database permissions."}
                        </T>
                      </View>
                    )}
                    <View
                      style={[
                        s.between,
                        {
                          marginTop: 32,
                          paddingTop: 20,
                          borderTopWidth: 1,
                          borderColor: t.border,
                        },
                      ]}
                    >
                      <BrandLogo night={night} width={120} />
                      <View style={s.row}>
                        <View style={s.activeDot} />
                        <T style={{ fontSize: 10, color: t.muted }}>
                          {demo
                            ? "Demo workspace · sample data"
                            : "Your private growth workspace"}
                        </T>
                      </View>
                    </View>
                  </>
                )}
              </ScrollView>
            </View>
              </>
            )}
            <Modal
              visible={!!modal}
              animationType="fade"
              transparent
              onRequestClose={() => setModal(null)}
            >
              <View style={s.modalBackdrop}>
                <View style={s.modal}>
                  <View style={[s.between, { marginBottom: 22 }]}>
                    <View>
                      <T style={s.eyebrow}>
                        {modal === "auth"
                          ? "WELCOME TO AISAS"
                          : modal === "profile"
                            ? "SCOUTING INTELLIGENCE"
                            : modal === "scout"
                              ? "NEW SCOUT"
                              : "CAMPAIGN STUDIO"}
                      </T>
                      <T
                        style={{
                          fontSize: 25,
                          fontWeight: "600",
                          marginTop: 8,
                        }}
                      >
                        {modal === "auth"
                          ? authMode === "signup"
                            ? "Create your account"
                            : "Welcome back."
                          : modal === "profile"
                            ? "Define your edge."
                            : modal === "scout"
                              ? "Find your people."
                              : "Make every message count."}
                      </T>
                    </View>
                    <Pressable
                      accessibilityLabel="Close dialog"
                      onPress={() => setModal(null)}
                      style={s.iconButton}
                    >
                      <X size={21} color={t.muted} />
                    </Pressable>
                  </View>
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 20 }}
                  >
                    {modal === "auth" && (
                      <View
                        style={{
                          backgroundColor: t.bg,
                          padding: 16,
                          borderRadius: 8,
                          marginBottom: 20,
                        }}
                      >
                        <BrandLogo night={night} width={compact ? 200 : 240} />
                      </View>
                    )}
                    {!!error && (
                      <T
                        accessibilityRole="alert"
                        style={{
                          color: "#D67C68",
                          fontSize: 12,
                          lineHeight: 20,
                          marginBottom: 16,
                        }}
                      >
                        {error}
                      </T>
                    )}
                    {modal === "auth" && (
                      <>
                        <T
                          style={[
                            s.muted,
                            { lineHeight: 22, marginBottom: 24 },
                          ]}
                        >
                          Your audience. Your campaigns. Your next chapter of
                          growth.
                        </T>
                        <Input
                          label="Email address"
                          value={email}
                          onChangeText={setEmail}
                          autoCapitalize="none"
                          keyboardType="email-address"
                          autoComplete="email"
                          placeholder="you@company.com"
                        />
                        <Input
                          label="Password"
                          value={password}
                          onChangeText={setPassword}
                          secureTextEntry
                          autoCapitalize="none"
                          autoComplete={
                            authMode === "signup"
                              ? "new-password"
                              : "current-password"
                          }
                          placeholder="At least 8 characters"
                        />
                        <Btn onPress={() => run("Signing in", () => auth())}>
                          {authMode === "signup" ? "Create account" : "Sign in"}
                        </Btn>
                        <Pressable
                          onPress={() =>
                            setAuthMode(
                              authMode === "signup" ? "signin" : "signup",
                            )
                          }
                        >
                          <T
                            style={{
                              color: t.muted,
                              fontSize: 12,
                              textAlign: "center",
                              marginTop: 22,
                            }}
                          >
                            {authMode === "signup"
                              ? "Already have an account? Sign in"
                              : "New here? Create an account"}
                          </T>
                        </Pressable>
                      </>
                    )}
                    {modal === "profile" && profile && (
                      <>
                        <Input
                          label="Profile name"
                          value={profile.name}
                          onChangeText={(v: string) =>
                            setProfile({ ...profile, name: v })
                          }
                          placeholder="e.g. Growth-minded hospitality"
                        />
                        {[
                          [
                            "audience",
                            "Target business category",
                            "Boutique hotels",
                          ],
                          ["location", "Target location", "Lagos, Nigeria"],
                          ["niche", "Your service niche", "Digital marketing"],
                          [
                            "sub_niche",
                            "Your sub-niche",
                            "Direct booking optimization",
                          ],
                          [
                            "usp",
                            "Your unique service proposition",
                            "What makes your approach different?",
                          ],
                          [
                            "offer",
                            "Your value / offer",
                            "What can you offer your audience?",
                          ],
                        ].map(([key, label, placeholder]) => (
                          <Input
                            key={key}
                            label={label}
                            value={profile[key as keyof ScoutingProfile]}
                            multiline={["usp", "offer"].includes(key)}
                            onChangeText={(v: string) =>
                              setProfile({ ...profile, [key]: v })
                            }
                            placeholder={placeholder}
                          />
                        ))}
                        <Btn
                          icon={Check}
                          onPress={() => run("Saving profile", storeProfile)}
                        >
                          Save audience profile
                        </Btn>
                      </>
                    )}
                    {modal === "scout" && (
                      <>
                        {choices(
                          "Choose an audience profile",
                          workspace.profiles,
                          activeProfile?.id || "",
                          (id) =>
                            setProfile(
                              workspace.profiles.find((p) => p.id === id) ||
                                null,
                            ),
                        )}
                        {!workspace.profiles.length && (
                          <Btn secondary onPress={newProfile}>
                            Create a profile
                          </Btn>
                        )}
                        {activeProfile && (
                          <>
                            <View style={[s.code, { marginBottom: 22 }]}>
                              <T
                                style={{
                                  fontSize: 11,
                                  color: t.accent,
                                  lineHeight: 21,
                                  fontFamily: "monospace",
                                }}
                              >
                                {booleanQuery(activeProfile)}
                              </T>
                            </View>
                            <T style={[s.muted, {fontSize:12,marginBottom:10}]}>Find prospects for</T>
                            <View style={[s.wrap,{marginBottom:20}]}>
                              {([['company','Companies'],['person','People']] as const).map(([kind,label]) => (
                                <Btn key={kind} secondary={scoutKind!==kind} onPress={() => setScoutKind(kind)}>{label}</Btn>
                              ))}
                            </View>
                            <Input
                              label="Save results to a new list"
                              value={listName}
                              onChangeText={setListName}
                              placeholder="e.g. Lagos hotels · November"
                            />
                            <T
                              style={[
                                s.muted,
                                {
                                  fontSize: 11,
                                  lineHeight: 21,
                                  marginBottom: 22,
                                },
                              ]}
                            >
                              {demo
                                ? "Demo mode will add clearly labeled sample prospects. Sign in to use live scouting."
                                : "Public-source results are saved to your list and contributed to the shared Search pool. Company scouting uses engines, directories, and Maps; People scouting looks for public professional profiles. Private list names, campaigns, and verification history are not shared."}
                            </T>
                            <Btn
                              icon={Radar}
                              onPress={() =>
                                run("Scouting your audience", scout)
                              }
                            >
                              {demo ? "Run demo scout" : "Launch scout"}
                            </Btn>
                          </>
                        )}
                      </>
                    )}
                    {modal === "campaign" && campaign && (
                      <>
                        <Input
                          label="Campaign name"
                          value={campaign.name}
                          onChangeText={(v: string) =>
                            setCampaign({
                              ...campaign,
                              name: v,
                              approved: false,
                            })
                          }
                          placeholder="e.g. Lagos hospitality · Direct bookings"
                        />
                        {choices(
                          "Audience list",
                          workspace.lists,
                          campaign.list_id,
                          (id) =>
                            setCampaign({
                              ...campaign,
                              list_id: id,
                              approved: false,
                            }),
                        )}
                        {choices(
                          "Service profile",
                          workspace.profiles,
                          campaign.profile_id,
                          (id) =>
                            setCampaign({
                              ...campaign,
                              profile_id: id,
                              approved: false,
                            }),
                        )}
                        {choices(
                          "Sending email account",
                          workspace.mailboxes.map((m) => ({
                            id: m.id,
                            name: m.email,
                          })),
                          campaign.mailbox_id,
                          (id) =>
                            setCampaign({
                              ...campaign,
                              mailbox_id: id,
                              approved: false,
                            }),
                        )}
                        <Btn
                          secondary
                          icon={Sparkles}
                          onPress={() =>
                            run("Writing your sequence", async () => {
                              const p = workspace.profiles.find(
                                (p) => p.id === campaign.profile_id,
                              );
                              if (!p)
                                throw new Error(
                                  "Create and select a service profile first.",
                                );
                              const messages = demo
                                ? draftMessages(p)
                                : (
                                    await api("generate-sequence", {
                                      profile_id: p.id,
                                    })
                                  ).messages;
                              setCampaign({
                                ...campaign,
                                messages,
                                approved: false,
                              });
                              setNotice(
                                demo
                                  ? "Template sequence created for the demo. Live AI generation requires sign-in and provider configuration."
                                  : "AI sequence generated. Review each message before approval.",
                              );
                            })
                          }
                        >
                          {demo ? "Generate demo sequence" : "Generate with AI"}
                        </Btn>
                        {!!campaign.messages.length && (
                          <>
                            <View style={[s.wrap, { marginVertical: 22 }]}>
                              {campaign.messages.map((m, i) => (
                                <Pressable
                                  key={i}
                                  onPress={() => setStep(i)}
                                  style={[
                                    s.choice,
                                    step === i && {
                                      borderColor: t.accent,
                                      backgroundColor: t.soft,
                                    },
                                  ]}
                                >
                                  <T
                                    style={{
                                      fontSize: 11,
                                      color: step === i ? t.accent : t.muted,
                                    }}
                                  >
                                    {i === 0
                                      ? "First message"
                                      : `Follow-up ${i}`}
                                  </T>
                                </Pressable>
                              ))}
                            </View>
                            <Input
                              label="Subject"
                              value={campaign.messages[step]?.subject || ""}
                              onChangeText={(v: string) =>
                                updateMessage({ subject: v })
                              }
                            />
                            <Input
                              label="Message"
                              value={campaign.messages[step]?.body || ""}
                              multiline
                              onChangeText={(v: string) =>
                                updateMessage({ body: v })
                              }
                              style={[
                                s.input,
                                { minHeight: 230, textAlignVertical: "top" },
                              ]}
                            />
                            <T
                              style={{
                                fontSize: 10,
                                color: t.muted,
                                marginTop: -8,
                                marginBottom: 20,
                              }}
                            >
                              Personalization:{" "}
                              {
                                "{{company}} · {{contact_name}} · {{location}} · {{category}}"
                              }
                            </T>
                            {step > 0 && (
                              <Input
                                label="Delay after previous message (hours)"
                                value={String(
                                  campaign.messages[step]?.delay_hours || "",
                                )}
                                keyboardType="numeric"
                                onChangeText={(v: string) =>
                                  updateMessage({ delay_hours: Number(v) })
                                }
                              />
                            )}
                            {sequencePreview && (
                              <View style={[s.code, { marginBottom: 20 }]}>
                                <T style={[s.eyebrow, { marginBottom: 10 }]}>
                                  PREVIEW · {sequencePreview.company}
                                </T>
                                <T style={{ fontSize: 12, lineHeight: 22 }}>
                                  {renderMessage(
                                    campaign.messages[step]?.body || "",
                                    sequencePreview,
                                  )}
                                </T>
                              </View>
                            )}
                          </>
                        )}
                        <Input
                          label="Start date (optional, ISO date with timezone)"
                          placeholder="2026-11-15T09:00:00+01:00"
                          value={campaign.start_at}
                          onChangeText={(v: string) =>
                            setCampaign({
                              ...campaign,
                              start_at: v,
                              approved: false,
                            })
                          }
                        />
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: campaign.approved }}
                          onPress={() =>
                            setCampaign({
                              ...campaign,
                              approved: !campaign.approved,
                            })
                          }
                          style={[s.row, { marginBottom: 24 }]}
                        >
                          <View
                            style={[
                              s.checkbox,
                              campaign.approved && {
                                backgroundColor: t.accent,
                                borderColor: t.accent,
                              },
                            ]}
                          >
                            {campaign.approved && (
                              <Check size={14} color={t.accentText} />
                            )}
                          </View>
                          <T style={{ fontSize: 12, lineHeight: 20, flex: 1 }}>
                            I have reviewed and approve all four messages and
                            the recipient list.
                          </T>
                        </Pressable>
                        <Btn
                          icon={Check}
                          onPress={() => run("Saving campaign", storeCampaign)}
                        >
                          Save campaign
                        </Btn>
                        <T
                          style={{
                            fontSize: 10,
                            color: t.muted,
                            marginTop: 14,
                            lineHeight: 18,
                          }}
                        >
                          Saving does not send emails. Launch the saved campaign
                          when you’re ready.
                        </T>
                      </>
                    )}
                    {!!busy && (
                      <View style={[s.row, { marginTop: 20 }]}>
                        <ActivityIndicator size="small" color={t.accent} />
                        <T style={s.muted}>{busy}…</T>
                      </View>
                    )}
                  </ScrollView>
                </View>
              </View>
            </Modal>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </UIContext.Provider>
  );
}
function LeadRow({
  lead: l,
  index,
  t,
  compact,
  onPress,
  onVerify,
  verifying,
  verificationError,
}: {
  lead: Lead;
  index: number;
  t: Theme;
  compact: boolean;
  onPress?: () => void;
  onVerify: () => void;
  verifying: boolean;
  verificationError?: string;
}) {
  const colors = ["#AFCB99", "#9FB8F1", "#D9B68D", "#B9A2CA"];
  const emailControl = (
    <EmailVerificationControl
      lead={l}
      theme={t}
      pending={verifying}
      error={verificationError}
      onVerify={onVerify}
    />
  );
  return (
    <View
      style={{
        paddingVertical: 18,
        gap: 12,
        borderBottomWidth: 1,
        borderColor: t.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <View
          style={{
            height: 35,
            width: 35,
            borderRadius: 10,
            backgroundColor: colors[index % 4] + "18",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: colors[index % 4],
              fontSize: 12,
              fontWeight: "700",
            }}
          >
            {l.company
              .split(" ")
              .filter((x) => x !== "The")
              .map((x) => x[0])
              .slice(0, 2)
              .join("")}
          </Text>
        </View>
        <Pressable disabled={!onPress} onPress={onPress} style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontWeight: "500", fontSize: 12 }}>
            {l.company}
          </Text>
          <Text style={{ color: t.muted, fontSize: 10, marginTop: 6 }}>
            {l.location}
          </Text>
        </Pressable>
        {!compact && (
          <View style={{ flex: 1.25, gap: 8 }}>
            <Text style={{ color: t.muted, fontSize: 11 }}>
              {l.contact_name || l.category}
            </Text>
            {l.email ? (
              emailControl
            ) : (
              <Text style={{ color: t.muted, fontSize: 10 }}>
                Email not found
              </Text>
            )}
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ color: t.accent, fontSize: 11 }}>{l.score}%</Text>
          <ArrowUpRight size={14} color={t.muted} />
        </View>
      </View>
      {compact && emailControl}
    </View>
  );
}
function Empty({ title, body, t }: any) {
  return (
    <View style={{ alignItems: "center", padding: 35, gap: 12 }}>
      <Radar color={t.muted} size={28} />
      <Text
        style={{
          color: t.text,
          fontSize: 16,
          fontWeight: "500",
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: t.muted,
          fontSize: 12,
          lineHeight: 21,
          textAlign: "center",
          maxWidth: 400,
        }}
      >
        {body}
      </Text>
    </View>
  );
}
function RadarArt({ color, muted }: any) {
  return (
    <Svg width={350} height={300} viewBox="0 0 350 300">
      <Defs>
        <LinearGradient id="beam" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.28" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      {[45, 78, 111, 144].map((r) => (
        <Circle
          key={r}
          cx="175"
          cy="150"
          r={r}
          stroke={muted}
          strokeWidth="1"
          fill="none"
        />
      ))}
      <Line x1="25" y1="150" x2="325" y2="150" stroke={muted} />
      <Line x1="175" y1="0" x2="175" y2="300" stroke={muted} />
      <Path d="M175 150 L175 6 A144 144 0 0 1 319 150 Z" fill="url(#beam)" />
      <Line
        x1="175"
        y1="150"
        x2="276"
        y2="48"
        stroke={color}
        strokeOpacity=".5"
      />
      <Circle cx="175" cy="150" r="5" fill={color} />
      {[
        [230, 90],
        [87, 124],
        [238, 210],
        [130, 230],
      ].map(([x, y], i) => (
        <React.Fragment key={i}>
          <Circle cx={x} cy={y} r="12" fill={color} opacity=".07" />
          <Circle
            cx={x}
            cy={y}
            r="4"
            fill={color}
            opacity={i === 0 ? 1 : 0.5}
          />
        </React.Fragment>
      ))}
    </Svg>
  );
}
const styles = (t: Theme, compact: boolean) =>
  StyleSheet.create({
    app: { flex: 1, backgroundColor: t.bg, flexDirection: "row" },
    text: {
      color: t.text,
      fontFamily:
        Platform.OS === "web"
          ? "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
          : undefined,
    },
    muted: { color: t.muted, fontSize: 12 },
    sidebar: {
      width: 220,
      backgroundColor: t.bg,
      borderRightWidth: 1,
      borderColor: t.border,
      padding: 20,
      paddingTop: 32,
    },
    brand: {
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      marginBottom: 34,
    },
    navLabel: {
      fontSize: 8,
      letterSpacing: 2,
      color: t.muted,
      marginBottom: 18,
      paddingLeft: 12,
    },
    navItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: 8,
    },
    navActive: { backgroundColor: t.raised },
    activeDot: {
      height: 5,
      width: 5,
      borderRadius: 5,
      backgroundColor: t.accent,
      marginLeft: "auto",
    },
    sidebarCard: {
      padding: 16,
      backgroundColor: t.panel,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      marginBottom: 28,
    },
    sidebarUser: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingTop: 22,
      marginTop: 15,
      borderTopWidth: 1,
      borderColor: t.border,
    },
    avatar: {
      width: 33,
      height: 33,
      borderRadius: 10,
      backgroundColor: t.soft,
      alignItems: "center",
      justifyContent: "center",
    },
    topbar: {
      height: 72,
      borderBottomWidth: 1,
      borderColor: t.border,
      paddingHorizontal: compact ? 20 : 36,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    between: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 10,
    },
    iconButton: { padding: 9, borderRadius: 7 },
    content: {
      padding: compact ? 20 : 36,
      paddingTop: compact ? 28 : 36,
      maxWidth: 1500,
      width: "100%",
      alignSelf: "center",
      paddingBottom: 36,
    },
    pageHeading: {
      flexDirection: compact ? "column" : "row",
      alignItems: compact ? "flex-start" : "center",
      justifyContent: "space-between",
      gap: 20,
      marginBottom: 30,
    },
    littleLine: { width: 17, height: 1, backgroundColor: t.accent },
    eyebrow: {
      fontSize: 8,
      letterSpacing: 1.7,
      color: t.muted,
      fontWeight: "600",
    },
    title: {
      fontSize: compact ? 27 : 31,
      fontWeight: "500",
      letterSpacing: -0.9,
    },
    btn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      backgroundColor: t.accent,
      paddingHorizontal: 18,
      paddingVertical: 13,
      borderRadius: 7,
      alignSelf: "flex-start",
      borderWidth: 1,
      borderColor: t.accent,
    },
    secondary: { backgroundColor: "transparent", borderColor: t.border },
    badge: {
      flexDirection: "row",
      alignSelf: "flex-start",
      alignItems: "center",
      gap: 7,
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderRadius: 5,
      borderWidth: 1,
    },
    hero: {
      position: "relative",
      overflow: "hidden",
      padding: compact ? 25 : 32,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.panel,
      borderRadius: 12,
      minHeight: 310,
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 24,
      gap: 20,
    },
    heroTitle: {
      fontSize: compact ? 33 : 42,
      letterSpacing: -1.6,
      lineHeight: compact ? 43 : 52,
      fontWeight: "500",
      marginTop: 20,
      marginBottom: 14,
    },
    radarWrap: { width: 350, height: 300, marginLeft: "auto" },
    radarFloat: {
      position: "absolute",
      bottom: 50,
      left: 5,
      backgroundColor: t.raised,
      borderWidth: 1,
      borderColor: t.border,
      padding: 12,
      borderRadius: 9,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
    },
    metrics: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 16,
      marginBottom: 24,
    },
    metric: {
      flex: 1,
      minWidth: compact ? 145 : 160,
      backgroundColor: t.panel,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      padding: 20,
    },
    twoCols: {
      flexDirection: compact ? "column" : "row",
      gap: 20,
      marginBottom: 24,
    },
    card: {
      backgroundColor: t.panel,
      padding: compact ? 20 : 24,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.border,
    },
    sectionHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      flexWrap: "wrap",
    },
    sectionTitle: { fontSize: 15, fontWeight: "600", letterSpacing: -0.2 },
    tinyPill: {
      paddingVertical: 6,
      paddingHorizontal: 9,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 5,
    },
    workflowIcon: {
      width: 43,
      height: 43,
      backgroundColor: t.soft,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    divider: { height: 1, backgroundColor: t.border },
    wrap: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    choice: {
      borderWidth: 1,
      borderColor: t.border,
      padding: 12,
      borderRadius: 7,
    },
    code: {
      padding: 18,
      backgroundColor: t.bg,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 7,
    },
    searchBox: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 7,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    notice: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.panel,
      padding: 16,
      borderRadius: 8,
      marginBottom: 20,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: "#000000B0",
      justifyContent: "center",
      alignItems: "center",
      padding: compact ? 12 : 35,
    },
    modal: {
      backgroundColor: t.panel,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 15,
      padding: compact ? 22 : 32,
      width: "100%",
      maxWidth: 720,
      maxHeight: "92%",
    },
    label: { fontSize: 12, fontWeight: "500", color: t.text },
    input: {
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.bg,
      color: t.text,
      padding: 13,
      borderRadius: 7,
      fontSize: 13,
      lineHeight: 21,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 5,
      alignItems: "center",
      justifyContent: "center",
    },
  });
