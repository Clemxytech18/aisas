import React, { useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  Platform,
} from "react-native";
import {
  ArrowRight,
  ArrowUpRight,
  Radar,
  Search,
  Check,
  CheckCircle2,
  ChevronDown,
  Plus,
  Minus,
  Menu,
  X,
  Mail,
  Send,
  ShieldCheck,
  Target,
  Clock,
  Pause,
  Users,
  Globe,
  Sparkles,
  Sun,
  Moon,
  Folder,
  Play,
} from "lucide-react-native";
import Svg, { Circle, Path, Line } from "react-native-svg";
import { BrandLogo, BrandIcon } from "./Brand";

type Props = {
  night: boolean;
  authenticated: boolean;
  notice?: string;
  error?: string;
  onSignup: () => void;
  onSignIn: () => void;
  onDemo: () => void;
  onWorkspace: () => void;
  onToggleTheme: () => void;
  onDismissNotice: () => void;
};
const INK = "#16251D",
  LIME = "#C0F580",
  IVORY = "#EFF5ED";
const previewSteps = ["Discover", "Verify", "Connect"] as const;
const faqs = [
  [
    "How does AISAS find prospects?",
    "Start with a business category and location. AISAS builds targeted searches across search engines, directories, and Maps-based results, then saves available contact details and source links to a named list.",
  ],
  [
    "Can I review messages before anything is sent?",
    "Yes. AI creates a first message and three follow-ups from your service profile, unique proposition, and offer. You can edit every message, choose delays, and approve the sequence before launching.",
  ],
  [
    "Which email accounts can I connect?",
    "Connect Gmail, Outlook, Yahoo, or a custom-domain mailbox. You can connect multiple accounts and choose the sender for each campaign. For custom domains, you supply your own incoming and outgoing mail settings during secure setup.",
  ],
  [
    "What does email verification tell me?",
    "Verify checks a saved prospect email in real time and records the result and timestamp. Addresses can be Verified, Invalid, or Unknown. Catch-all domains and inconclusive checks are shown honestly as Unknown; verification does not guarantee delivery.",
  ],
  [
    "Can I explore AISAS before signing up?",
    "Yes. Explore the demo workspace to see sample profiles, lists, and campaign sequences. Demo actions use sample data and do not perform live scouting or send campaign emails.",
  ],
  [
    "Can I use AISAS on mobile?",
    "The web workspace adapts to mobile screens. Dedicated Android and iOS app releases are planned; there are no app-store downloads to install yet.",
  ],
];

function Copy({ children, style, ...rest }: any) {
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily:
            Platform.OS === "web"
              ? "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
              : undefined,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
function Pill({ children, light = false }: any) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderWidth: 1,
        borderColor: light ? "#BCCCB0" : "#3A4C36",
        borderRadius: 30,
        paddingHorizontal: 11,
        paddingVertical: 7,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
      }}
    >
      <View
        style={{
          width: 5,
          height: 5,
          borderRadius: 5,
          backgroundColor: light ? INK : LIME,
        }}
      />
      <Copy
        style={{
          color: light ? INK : LIME,
          fontSize: 10,
          fontWeight: "600",
          letterSpacing: 0.8,
        }}
      >
        {children}
      </Copy>
    </View>
  );
}
function Action({
  children,
  onPress,
  secondary = false,
  inverse = false,
  small = false,
  icon = true,
}: any) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        paddingHorizontal: small ? 17 : 23,
        paddingVertical: small ? 12 : 17,
        minHeight: small ? 43 : 53,
        borderRadius: 8,
        backgroundColor: inverse ? INK : secondary ? "transparent" : LIME,
        borderWidth: 1,
        borderColor: inverse ? INK : secondary ? "#617368" : LIME,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Copy
        style={{
          color: inverse ? IVORY : secondary ? undefined : INK,
          fontSize: small ? 12 : 14,
          fontWeight: "700",
        }}
      >
        {children}
      </Copy>
      {icon && (
        <ArrowUpRight
          size={small ? 15 : 18}
          color={inverse ? IVORY : secondary ? "#9DADA2" : INK}
        />
      )}
    </Pressable>
  );
}

export function LandingPage(props: Props) {
  const { width } = useWindowDimensions();
  const mobile = width < 900;
  const tiny = width < 520;
  const c = props.night
    ? {
        bg: "#0A100F",
        panel: "#111A17",
        raised: "#18231F",
        border: "#29362E",
        text: IVORY,
        muted: "#A2B0A5",
      }
    : {
        bg: "#F5F6F1",
        panel: "#FFFFFF",
        raised: "#E8EEE1",
        border: "#D7DFD2",
        text: INK,
        muted: "#536653",
      };
  const s = styles(c, mobile, tiny);
  const scroll = useRef<ScrollView>(null);
  const sections = useRef<Record<string, number>>({});
  const [menu, setMenu] = useState(false);
  const [preview, setPreview] = useState(0);
  const [faq, setFaq] = useState<number | null>(0);
  const start = props.authenticated ? props.onWorkspace : props.onSignup;
  const jump = (name: string) => {
    setMenu(false);
    scroll.current?.scrollTo({
      y: Math.max(0, (sections.current[name] || 0) - 24),
      animated: true,
    });
  };
  const navLink = (label: string, id: string) => (
    <Pressable
      key={id}
      accessibilityRole="button"
      onPress={() => jump(id)}
      style={{ padding: 10 }}
    >
      <Copy style={{ color: c.muted, fontSize: 12, fontWeight: "500" }}>
        {label}
      </Copy>
    </Pressable>
  );
  const heading = (
    eyebrow: string,
    title: string,
    description?: string,
    center = false,
  ) => (
    <View
      style={{
        alignItems: center ? "center" : "flex-start",
        gap: 16,
        marginBottom: 40,
      }}
    >
      <Copy
        style={{
          fontSize: 10,
          fontWeight: "600",
          letterSpacing: 2,
          color: c.muted,
        }}
      >
        {eyebrow}
      </Copy>
      <Copy
        accessibilityRole="header"
        style={[s.h2, center && { textAlign: "center" }]}
      >
        {title}
      </Copy>
      {description && (
        <Copy
          style={[s.body, { maxWidth: 630 }, center && { textAlign: "center" }]}
        >
          {description}
        </Copy>
      )}
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[s.header, { zIndex: 10 }]}>
        <View style={s.headerInner}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="AISAS home"
            onPress={() => jump("top")}
          >
            <BrandLogo
              night={props.night}
              width={tiny ? 122 : 165}
              accessible={false}
            />
          </Pressable>
          {!mobile && (
            <View style={s.row}>
              {navLink("Platform", "features")}
              {navLink("How it works", "workflow")}
              {navLink("FAQ", "faq")}
            </View>
          )}
          <View style={[s.row, { gap: tiny ? 5 : 13 }]}>
            {!mobile && (
              <Pressable
                accessibilityLabel="Toggle day and night mode"
                onPress={props.onToggleTheme}
                style={{ padding: 9 }}
              >
                {props.night ? (
                  <Sun size={17} color={c.muted} />
                ) : (
                  <Moon size={17} color={c.muted} />
                )}
              </Pressable>
            )}
            {!mobile && (
              <Pressable
                accessibilityRole="button"
                onPress={
                  props.authenticated ? props.onWorkspace : props.onSignIn
                }
                style={{ padding: 10 }}
              >
                <Copy
                  style={{ color: c.text, fontSize: 12, fontWeight: "600" }}
                >
                  {props.authenticated ? "Workspace" : "Sign in"}
                </Copy>
              </Pressable>
            )}
            <Action small onPress={start}>
              {mobile
                ? props.authenticated
                  ? "Open app"
                  : "Sign up"
                : props.authenticated
                  ? "Open workspace"
                  : "Get started"}
            </Action>
            {mobile && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  menu ? "Close navigation" : "Open navigation"
                }
                accessibilityState={{ expanded: menu }}
                onPress={() => setMenu(!menu)}
                style={{ padding: 9 }}
              >
                {menu ? (
                  <X size={22} color={c.text} />
                ) : (
                  <Menu size={22} color={c.text} />
                )}
              </Pressable>
            )}
          </View>
        </View>
        {mobile && menu && (
          <View
            style={[
              s.mobileMenu,
              { backgroundColor: c.panel, borderColor: c.border },
            ]}
          >
            {navLink("Platform", "features")}
            {navLink("How it works", "workflow")}
            {navLink("FAQ", "faq")}
            <Pressable
              onPress={() => {
                setMenu(false);
                (props.authenticated ? props.onWorkspace : props.onSignIn)();
              }}
              style={{ padding: 10 }}
            >
              <Copy style={{ color: c.text, fontWeight: "600" }}>
                {props.authenticated ? "Workspace" : "Sign in"}
              </Copy>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={props.onToggleTheme}
              style={{ padding: 10 }}
            >
              <Copy style={{ color: c.text, fontSize: 12 }}>
                Switch to {props.night ? "day" : "night"} mode
              </Copy>
            </Pressable>
            <Action
              small
              onPress={() => {
                setMenu(false);
                start();
              }}
            >
              {props.authenticated ? "Open workspace" : "Create account"}
            </Action>
          </View>
        )}
      </View>
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingBottom: 28 }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          onLayout={(e) => {
            sections.current.top = e.nativeEvent.layout.y;
          }}
          style={s.heroSection}
        >
          {!!props.notice && (
            <View accessibilityRole="alert" style={s.notice}>
              <CheckCircle2 size={18} color={c.text} />
              <Copy
                style={{ color: c.text, flex: 1, fontSize: 13, lineHeight: 21 }}
              >
                {props.notice}
              </Copy>
              <Pressable
                accessibilityLabel="Dismiss message"
                onPress={props.onDismissNotice}
              >
                <X size={16} color={c.text} />
              </Pressable>
            </View>
          )}
          {!!props.error && (
            <View accessibilityRole="alert" style={s.notice}>
              <Copy style={{ color: c.text, fontSize: 13, lineHeight: 21 }}>
                {props.error}
              </Copy>
            </View>
          )}
          <View style={s.heroGrid}>
            <View
              style={{
                flex: mobile ? undefined : 1.05,
                width: mobile ? "100%" : undefined,
                alignItems: "flex-start",
              }}
            >
              <Pill light={!props.night}>
                YOUR NEXT OPPORTUNITY STARTS HERE
              </Pill>
              <Copy accessibilityRole="header" style={s.h1}>
                Find the right people.{"\n"}Lead with{" "}
                <Copy style={{ color: props.night ? LIME : "#3B6338" }}>
                  your value.
                </Copy>
              </Copy>
              <Copy
                style={[
                  s.body,
                  { maxWidth: 480, fontSize: mobile ? 15 : 16, lineHeight: 28 },
                ]}
              >
                Turn your ideal audience into your next great conversation.
                Discover prospects, verify their emails, and create personalized
                outreach—all in one focused workspace.
              </Copy>
              <View
                style={[s.row, { flexWrap: "wrap", gap: 12, marginTop: 30 }]}
              >
                <Action onPress={start}>
                  {props.authenticated
                    ? "Open your workspace"
                    : "Create your AISAS account"}
                </Action>
                <Pressable
                  accessibilityRole="button"
                  onPress={
                    props.authenticated ? () => jump("workflow") : props.onDemo
                  }
                  style={[s.row, { padding: 14 }]}
                >
                  <Play size={14} color={c.text} />
                  <Copy
                    style={{ color: c.text, fontSize: 13, fontWeight: "500" }}
                  >
                    {props.authenticated
                      ? "See how it works"
                      : "Explore the demo"}
                  </Copy>
                </Pressable>
              </View>
              <View
                style={[s.row, { gap: 18, marginTop: 24, flexWrap: "wrap" }]}
              >
                {["Email signup", "Review before you send"].map((label) => (
                  <View key={label} style={[s.row, { gap: 6 }]}>
                    <Check size={13} color={c.muted} />
                    <Copy style={{ color: c.muted, fontSize: 11 }}>
                      {label}
                    </Copy>
                  </View>
                ))}
              </View>
            </View>
            <View
              style={{
                flex: mobile ? undefined : 1,
                minWidth: 0,
                width: mobile ? "100%" : undefined,
              }}
            >
              <ProductPreview
                selected={preview}
                setSelected={setPreview}
                mobile={mobile}
              />
            </View>
          </View>
          <View style={s.audienceBar}>
            <Copy style={{ fontSize: 10, color: c.muted, letterSpacing: 1.4 }}>
              BUILT FOR PEOPLE WHO BUILD BUSINESSES
            </Copy>
            <View style={[s.row, { gap: mobile ? 20 : 42, flexWrap: "wrap" }]}>
              {["Agencies", "Consultants", "Sales teams"].map((name, i) => (
                <View key={name} style={s.row}>
                  {i === 0 ? (
                    <Globe size={17} color={c.muted} />
                  ) : i === 1 ? (
                    <Target size={17} color={c.muted} />
                  ) : (
                    <Users size={17} color={c.muted} />
                  )}
                  <Copy
                    style={{
                      fontSize: mobile ? 13 : 15,
                      fontWeight: "500",
                      color: c.text,
                    }}
                  >
                    {name}
                  </Copy>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View
          onLayout={(e) => {
            sections.current.features = e.nativeEvent.layout.y;
          }}
          style={s.section}
        >
          {heading(
            "PURPOSE-BUILT FOR YOUR NEXT MOVE",
            "A clearer path from prospect\nto conversation.",
            "Your audience, your offer, and your outreach belong together. AISAS connects the work so you can focus on the people behind the list.",
          )}
          <View style={[s.split, { alignItems: "stretch" }]}>
            <View
              style={[
                s.featureCard,
                { flex: mobile ? undefined : 1.15, padding: mobile ? 24 : 34 },
              ]}
            >
              <View style={s.featureIcon}>
                <Radar size={25} color={props.night ? LIME : INK} />
              </View>
              <Copy style={s.cardKicker}>01 / AI SCOUTING</Copy>
              <Copy style={s.h3}>
                Less digging.{"\n"}More relevant discoveries.
              </Copy>
              <Copy style={s.body}>
                Define the business category and location you want to reach.
                Search engines, directories, and Maps-based results help surface
                prospects with available contact details and source links.
              </Copy>
              <View style={[s.queryCard, { marginTop: 28 }]}>
                <View style={[s.row, { marginBottom: 15 }]}>
                  <Search size={15} color={LIME} />
                  <Copy
                    style={{ color: "#A2B0A5", fontSize: 10, letterSpacing: 1 }}
                  >
                    SCOUTING WITH INTENT
                  </Copy>
                </View>
                <Copy
                  style={{
                    color: LIME,
                    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                    fontSize: 13,
                    lineHeight: 25,
                  }}
                >
                  "boutique hotels" AND "Lagos"{"\n"}AND ("contact" OR "email")
                </Copy>
                <View
                  style={{
                    height: 1,
                    backgroundColor: "#29362E",
                    marginVertical: 18,
                  }}
                />
                <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>
                  {["Email", "Phone", "Website", "LinkedIn"].map((x) => (
                    <View
                      key={x}
                      style={{
                        borderRadius: 4,
                        paddingVertical: 5,
                        paddingHorizontal: 8,
                        backgroundColor: "#1D2D23",
                      }}
                    >
                      <Copy style={{ fontSize: 10, color: "#B7C5BA" }}>
                        {x}
                      </Copy>
                    </View>
                  ))}
                </View>
                <Copy style={{ color: "#91A194", fontSize: 10, marginTop: 12 }}>
                  Contact fields are captured when available.
                </Copy>
              </View>
            </View>
            <View style={{ flex: mobile ? undefined : 1, gap: 20 }}>
              <View style={s.featureCard}>
                <View style={s.row}>
                  <ShieldCheck size={22} color={props.night ? LIME : INK} />
                  <Copy style={s.cardKicker}>02 / EMAIL VERIFICATION</Copy>
                </View>
                <Copy style={s.h3}>Check before you connect.</Copy>
                <Copy style={s.body}>
                  Verify a prospect email in real time. Get a clear result and a
                  last-checked timestamp before deciding who to contact.
                </Copy>
                <View style={{ gap: 12, marginTop: 25 }}>
                  {[
                    {
                      email: "hello@harbor.example",
                      label: "Verified",
                      color: props.night ? LIME : "#376238",
                    },
                    {
                      email: "old@studio.example",
                      label: "Invalid",
                      color: props.night ? "#EA9D89" : "#A43826",
                    },
                    {
                      email: "team@nord.example",
                      label: "Unknown",
                      color: c.muted,
                    },
                  ].map((x) => (
                    <View key={x.email} style={[s.between, { gap: 6 }]}>
                      <Copy style={{ color: c.muted, fontSize: 11 }}>
                        {x.email}
                      </Copy>
                      <View style={[s.row, { gap: 5 }]}>
                        {x.label === "Verified" ? (
                          <CheckCircle2 size={13} color={x.color} />
                        ) : (
                          <View
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: 4,
                              backgroundColor: x.color,
                            }}
                          />
                        )}
                        <Copy
                          style={{
                            color: x.color,
                            fontSize: 10,
                            fontWeight: "600",
                          }}
                        >
                          {x.label}
                        </Copy>
                      </View>
                    </View>
                  ))}
                </View>
                <Copy style={{ color: c.muted, fontSize: 9, marginTop: 16 }}>
                  Illustrative preview · sample addresses
                </Copy>
              </View>
              <View
                style={[
                  s.featureCard,
                  { backgroundColor: props.night ? "#19271B" : "#E7EFDF" },
                ]}
              >
                <View style={s.row}>
                  <Folder size={22} color={props.night ? LIME : INK} />
                  <Copy style={s.cardKicker}>03 / NAMED AUDIENCE LISTS</Copy>
                </View>
                <Copy style={s.h3}>Good prospects deserve a home.</Copy>
                <Copy style={s.body}>
                  Save discoveries to lists you name. Find the right contacts
                  again, search your prospects, and build campaigns around a
                  focused audience.
                </Copy>
              </View>
            </View>
          </View>
          <View style={[s.featureCard, s.sequenceFeature, { marginTop: 20 }]}>
            <View style={{ flex: mobile ? undefined : 1 }}>
              <View style={s.row}>
                <Sparkles size={22} color={props.night ? LIME : INK} />
                <Copy style={s.cardKicker}>04 / PERSONALIZED CAMPAIGNS</Copy>
              </View>
              <Copy style={[s.h3, { fontSize: mobile ? 27 : 34 }]}>
                A better first message.{"\n"}A thoughtful next step.
              </Copy>
              <Copy style={[s.body, { maxWidth: 440 }]}>
                Give AI your niche, unique proposition, and offer. Get a
                value-first message and three follow-ups, then edit and approve
                the sequence before launch.
              </Copy>
              <View
                style={[s.row, { flexWrap: "wrap", gap: 18, marginTop: 22 }]}
              >
                {["Personalize", "Review", "Approve"].map((x) => (
                  <View style={s.row} key={x}>
                    <Check size={13} color={c.text} />
                    <Copy style={{ color: c.text, fontSize: 11 }}>{x}</Copy>
                  </View>
                ))}
              </View>
            </View>
            <View style={[s.sequenceCard, { flex: mobile ? undefined : 1 }]}>
              <View style={s.between}>
                <Copy style={{ fontSize: 11, color: c.muted }}>
                  YOUR OUTREACH SEQUENCE
                </Copy>
                <ShieldCheck size={16} color={c.text} />
              </View>
              <View style={{ marginTop: 23, gap: 0 }}>
                {[
                  {
                    name: "First message",
                    delay: "Your opening value",
                    active: true,
                  },
                  { name: "Follow-up 1", delay: "48 hours later" },
                  { name: "Follow-up 2", delay: "72 hours later" },
                  { name: "Follow-up 3", delay: "120 hours later" },
                ].map((m, i) => (
                  <View
                    key={m.name}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 14,
                      paddingVertical: 11,
                    }}
                  >
                    <View
                      style={{
                        width: 27,
                        height: 27,
                        borderRadius: 8,
                        backgroundColor: m.active ? LIME : c.raised,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Copy
                        style={{
                          fontSize: 10,
                          fontWeight: "600",
                          color: m.active ? INK : c.muted,
                        }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </Copy>
                    </View>
                    <Copy style={{ color: c.text, fontSize: 12, flex: 1 }}>
                      {m.name}
                    </Copy>
                    <Copy style={{ color: c.muted, fontSize: 10 }}>
                      {m.delay}
                    </Copy>
                  </View>
                ))}
              </View>
              <Copy style={{ fontSize: 10, color: c.muted, marginTop: 15 }}>
                Example timing. Set the delays that suit your campaign.
              </Copy>
            </View>
          </View>
        </View>

        <View
          onLayout={(e) => {
            sections.current.workflow = e.nativeEvent.layout.y;
          }}
          style={s.workflowBand}
        >
          <View style={s.workflowInner}>
            <View style={{ gap: 16, maxWidth: 650, marginBottom: 46 }}>
              <Copy
                style={{
                  color: "#62745E",
                  fontSize: 10,
                  fontWeight: "600",
                  letterSpacing: 2,
                }}
              >
                HOW IT WORKS
              </Copy>
              <Copy accessibilityRole="header" style={[s.h2, { color: INK }]}>
                One clear workflow.{"\n"}Four purposeful steps.
              </Copy>
            </View>
            <View style={[s.split, { gap: mobile ? 30 : 26 }]}>
              {[
                {
                  n: "01",
                  title: "Define your edge",
                  body: "Choose your audience and location. Add your service niche, unique proposition, and offer.",
                  icon: Target,
                },
                {
                  n: "02",
                  title: "Scout your audience",
                  body: "Discover relevant businesses and save available contact details to a named list.",
                  icon: Radar,
                },
                {
                  n: "03",
                  title: "Prepare to connect",
                  body: "Verify selected emails and review the personalized messages AI drafts for your offer.",
                  icon: ShieldCheck,
                },
                {
                  n: "04",
                  title: "Launch with intention",
                  body: "Choose a sending account, start date, and follow-up delays. Pause or restart when needed.",
                  icon: Send,
                },
              ].map((x) => (
                <View
                  key={x.n}
                  style={{ flex: mobile ? undefined : 1, gap: 14 }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <View
                      style={{
                        height: 42,
                        width: 42,
                        borderRadius: 12,
                        backgroundColor: "#DBE7CE",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <x.icon size={20} color={INK} />
                    </View>
                    <View
                      style={{ height: 1, flex: 1, backgroundColor: "#C9D5C0" }}
                    />
                    <Copy style={{ fontSize: 11, color: "#62745E" }}>
                      {x.n}
                    </Copy>
                  </View>
                  <Copy
                    style={{
                      fontSize: 18,
                      fontWeight: "600",
                      color: INK,
                      marginTop: 7,
                    }}
                  >
                    {x.title}
                  </Copy>
                  <Copy
                    style={{ fontSize: 13, lineHeight: 23, color: "#536653" }}
                  >
                    {x.body}
                  </Copy>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.mailFeature}>
            <View style={{ flex: mobile ? undefined : 1 }}>
              <Copy style={s.cardKicker}>YOUR INBOX. YOUR IDENTITY.</Copy>
              <Copy style={s.h2}>
                Your offer. Your voice.{"\n"}Your email account.
              </Copy>
              <Copy style={[s.body, { maxWidth: 460, marginTop: 20 }]}>
                Connect multiple mailboxes and select the right sender for each
                campaign. Custom-domain users bring their own mailbox settings.
              </Copy>
              <View style={{ gap: 15, marginTop: 28 }}>
                {[
                  {
                    icon: CheckCircle2,
                    text: "Review and approve before launch",
                  },
                  {
                    icon: Clock,
                    text: "Choose your start date and follow-up timing",
                  },
                  { icon: Pause, text: "Pause and restart your campaigns" },
                ].map((x) => (
                  <View style={s.row} key={x.text}>
                    <x.icon size={16} color={props.night ? LIME : INK} />
                    <Copy style={{ fontSize: 12, color: c.text }}>
                      {x.text}
                    </Copy>
                  </View>
                ))}
              </View>
            </View>
            <View style={[s.mailCard, { flex: mobile ? undefined : 0.9 }]}>
              <Copy
                style={{
                  fontSize: 10,
                  letterSpacing: 1.2,
                  color: c.muted,
                  marginBottom: 24,
                }}
              >
                CHOOSE YOUR SENDING ACCOUNT
              </Copy>
              {[
                { letter: "G", name: "Gmail", color: "#EA9D89" },
                { letter: "O", name: "Outlook", color: "#94B8EE" },
                { letter: "Y", name: "Yahoo", color: "#BDA0F0" },
                {
                  letter: "@",
                  name: "Your custom domain",
                  color: props.night ? LIME : INK,
                },
              ].map((x) => (
                <View
                  key={x.name}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 14,
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderColor: c.border,
                  }}
                >
                  <View
                    style={{
                      width: 31,
                      height: 31,
                      borderRadius: 8,
                      backgroundColor: c.raised,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Copy
                      style={{
                        fontSize: 16,
                        fontWeight: "700",
                        color: x.color,
                      }}
                    >
                      {x.letter}
                    </Copy>
                  </View>
                  <Copy style={{ fontSize: 13, color: c.text, flex: 1 }}>
                    {x.name}
                  </Copy>
                  <ArrowUpRight size={14} color={c.muted} />
                </View>
              ))}
            </View>
          </View>
        </View>

        <View
          onLayout={(e) => {
            sections.current.faq = e.nativeEvent.layout.y;
          }}
          style={[s.section, { paddingTop: 15 }]}
        >
          <View style={s.faqGrid}>
            <View style={{ flex: mobile ? undefined : 0.8 }}>
              {heading("A LITTLE CLARITY", "Good questions.\nClear answers.")}
              <Pressable
                accessibilityRole="button"
                onPress={props.authenticated ? props.onWorkspace : props.onDemo}
                style={s.row}
              >
                <Copy
                  style={{ color: c.text, fontSize: 13, fontWeight: "600" }}
                >
                  {props.authenticated
                    ? "Return to your workspace"
                    : "Take a look inside the demo"}
                </Copy>
                <ArrowUpRight size={17} color={c.text} />
              </Pressable>
            </View>
            <View style={{ flex: mobile ? undefined : 1.2 }}>
              {faqs.map(([question, answer], i) => (
                <View
                  key={question}
                  style={{ borderBottomWidth: 1, borderColor: c.border }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: faq === i }}
                    onPress={() => setFaq(faq === i ? null : i)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 20,
                      paddingVertical: 23,
                    }}
                  >
                    <Copy
                      style={{
                        color: c.text,
                        fontSize: 14,
                        fontWeight: "500",
                        lineHeight: 23,
                        flex: 1,
                      }}
                    >
                      {question}
                    </Copy>
                    {faq === i ? (
                      <Minus size={18} color={c.muted} />
                    ) : (
                      <Plus size={18} color={c.muted} />
                    )}
                  </Pressable>
                  {faq === i && (
                    <Copy
                      style={[
                        s.body,
                        {
                          fontSize: 13,
                          lineHeight: 24,
                          paddingBottom: 24,
                          paddingRight: 25,
                        },
                      ]}
                    >
                      {answer}
                    </Copy>
                  )}
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.finalCta}>
            <View style={{ zIndex: 1, maxWidth: 690 }}>
              <Pill light>INTELLIGENCE INTO OPPORTUNITY</Pill>
              <Copy
                accessibilityRole="header"
                style={{
                  fontSize: mobile ? 35 : 49,
                  lineHeight: mobile ? 43 : 57,
                  letterSpacing: -1.8,
                  color: INK,
                  fontWeight: "500",
                  marginTop: 25,
                  marginBottom: 18,
                }}
              >
                Your next great conversation{"\n"}starts with a better list.
              </Copy>
              <Copy
                style={{
                  color: "#36582D",
                  fontSize: 14,
                  lineHeight: 25,
                  maxWidth: 520,
                  marginBottom: 26,
                }}
              >
                Put your audience, your offer, and your outreach in one place.
                Make your first move with AISAS.
              </Copy>
              <Action inverse onPress={start}>
                {props.authenticated
                  ? "Open your workspace"
                  : "Create your account"}
              </Action>
            </View>
            {!mobile && (
              <View
                style={{
                  position: "absolute",
                  right: -65,
                  top: 20,
                  opacity: 0.25,
                }}
              >
                <RadarLines color="#294B22" size={350} />
              </View>
            )}
          </View>
        </View>
        <View style={s.footer}>
          <View style={{ gap: 14 }}>
            <BrandLogo night={props.night} width={160} />
            <Copy style={{ color: c.muted, fontSize: 11 }}>
              AI Scouting Automation System
            </Copy>
          </View>
          <View style={[s.row, { flexWrap: "wrap", gap: 16 }]}>
            {navLink("Platform", "features")}
            {navLink("How it works", "workflow")}
            {navLink("FAQ", "faq")}
            <Pressable
              onPress={props.authenticated ? props.onWorkspace : props.onSignIn}
              style={{ padding: 10 }}
            >
              <Copy style={{ fontSize: 12, color: c.muted }}>
                {props.authenticated ? "Workspace" : "Sign in"}
              </Copy>
            </Pressable>
          </View>
          <Copy style={{ color: c.muted, fontSize: 10 }}>
            © {new Date().getFullYear()} ClemxyTech
          </Copy>
        </View>
      </ScrollView>
    </View>
  );
}

function RadarLines({ color, size = 300 }: any) {
  return (
    <Svg width={size} height={size} viewBox="0 0 300 300">
      {[40, 75, 110, 145].map((r) => (
        <Circle
          key={r}
          cx="150"
          cy="150"
          r={r}
          stroke={color}
          strokeWidth="1"
          fill="none"
        />
      ))}
      <Line x1="0" y1="150" x2="300" y2="150" stroke={color} />
      <Line x1="150" y1="0" x2="150" y2="300" stroke={color} />
      <Path
        d="M150 150 L150 5 A145 145 0 0 1 295 150 Z"
        fill={color}
        fillOpacity=".08"
      />
    </Svg>
  );
}
function ProductPreview({ selected, setSelected, mobile }: any) {
  const rows = [
    {
      name: "Harbor House",
      category: "Boutique hotel",
      initials: "HH",
      color: "#BCD99D",
    },
    {
      name: "Nord & Co.",
      category: "Hospitality group",
      initials: "NC",
      color: "#9FB8F1",
    },
    {
      name: "Verde Studio",
      category: "Independent business",
      initials: "VS",
      color: "#D5B590",
    },
  ];
  return (
    <View
      style={{
        backgroundColor: "#111A17",
        borderColor: "#304132",
        borderWidth: 1,
        borderRadius: 16,
        padding: mobile ? 18 : 24,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 22,
        }}
      >
        <View style={{ flexDirection: "row", gap: 9, alignItems: "center" }}>
          <BrandIcon size={25} />
          <Copy style={{ color: IVORY, fontSize: 11, fontWeight: "600" }}>
            YOUR SCOUTING WORKSPACE
          </Copy>
        </View>
        <View style={{ flexDirection: "row", gap: 4 }}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{
                height: 4,
                width: 4,
                borderRadius: 4,
                backgroundColor: "#6C806F",
              }}
            />
          ))}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 22 }}>
        {previewSteps.map((x, i) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: selected === i }}
            key={x}
            onPress={() => setSelected(i)}
            style={{
              flex: 1,
              paddingVertical: 10,
              alignItems: "center",
              borderRadius: 6,
              backgroundColor: selected === i ? "#C0F580" : "#1B2820",
            }}
          >
            <Copy
              style={{
                color: selected === i ? INK : "#9DADA2",
                fontSize: 11,
                fontWeight: "600",
              }}
            >
              {x}
            </Copy>
          </Pressable>
        ))}
      </View>
      <View style={{ minHeight: 325 }}>
        {selected === 0 && (
          <>
            <View
              style={{
                height: 135,
                backgroundColor: "#0A100F",
                borderRadius: 9,
                overflow: "hidden",
                justifyContent: "center",
                padding: 18,
                marginBottom: 20,
              }}
            >
              <View
                style={{
                  position: "absolute",
                  right: -8,
                  top: -58,
                  opacity: 0.5,
                }}
              >
                <RadarLines color={LIME} size={250} />
              </View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 12,
                }}
              >
                <View
                  style={{
                    height: 5,
                    width: 5,
                    borderRadius: 5,
                    backgroundColor: LIME,
                  }}
                />
                <Copy style={{ fontSize: 8, letterSpacing: 1.2, color: LIME }}>
                  AUDIENCE PROFILE
                </Copy>
              </View>
              <Copy style={{ fontSize: 20, color: IVORY, fontWeight: "500" }}>
                Hospitality in Lagos
              </Copy>
              <Copy style={{ fontSize: 10, color: "#9DADA2", marginTop: 9 }}>
                A focused list. A clearer next move.
              </Copy>
            </View>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <Copy style={{ color: IVORY, fontSize: 11, fontWeight: "500" }}>
                Your next connections
              </Copy>
              <Copy style={{ color: "#9DADA2", fontSize: 9 }}>
                3 sample prospects
              </Copy>
            </View>
            {rows.map((r) => (
              <View
                key={r.name}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderColor: "#29362E",
                }}
              >
                <View
                  style={{
                    width: 29,
                    height: 29,
                    borderRadius: 8,
                    backgroundColor: r.color + "18",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Copy
                    style={{ color: r.color, fontSize: 9, fontWeight: "700" }}
                  >
                    {r.initials}
                  </Copy>
                </View>
                <View style={{ flex: 1 }}>
                  <Copy style={{ color: IVORY, fontSize: 11 }}>{r.name}</Copy>
                  <Copy style={{ color: "#9DADA2", fontSize: 9, marginTop: 5 }}>
                    {r.category}
                  </Copy>
                </View>
                <ArrowUpRight size={14} color="#9DADA2" />
              </View>
            ))}
          </>
        )}
        {selected === 1 && (
          <>
            <View
              style={{
                backgroundColor: "#0A100F",
                borderRadius: 9,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <ShieldCheck size={28} color={LIME} />
              <Copy
                style={{
                  fontSize: 21,
                  color: IVORY,
                  fontWeight: "500",
                  marginTop: 16,
                }}
              >
                Confidence before contact.
              </Copy>
              <Copy
                style={{
                  fontSize: 12,
                  color: "#9DADA2",
                  lineHeight: 22,
                  marginTop: 12,
                }}
              >
                Check an address and keep its result with your prospect.
              </Copy>
            </View>
            {["Verified", "Invalid", "Unknown"].map((status, i) => (
              <View
                key={status}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  gap: 10,
                  paddingVertical: 18,
                  borderBottomWidth: 1,
                  borderColor: "#29362E",
                }}
              >
                <Copy style={{ fontSize: 11, color: "#AAB8AC" }}>
                  {
                    [
                      "hello@harbor.example",
                      "old@studio.example",
                      "team@nord.example",
                    ][i]
                  }
                </Copy>
                <Copy
                  style={{
                    fontSize: 10,
                    color: i === 0 ? LIME : i === 1 ? "#EA9D89" : "#9DADA2",
                    fontWeight: "600",
                  }}
                >
                  {status}
                </Copy>
              </View>
            ))}
          </>
        )}
        {selected === 2 && (
          <>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 18,
              }}
            >
              <Copy style={{ fontSize: 11, color: "#9DADA2" }}>
                FIRST MESSAGE
              </Copy>
              <View
                style={{ flexDirection: "row", gap: 5, alignItems: "center" }}
              >
                <ShieldCheck size={12} color={LIME} />
                <Copy style={{ fontSize: 9, color: LIME }}>
                  Your approval first
                </Copy>
              </View>
            </View>
            <View
              style={{
                backgroundColor: "#0A100F",
                padding: 20,
                borderRadius: 9,
              }}
            >
              <Copy
                style={{
                  color: IVORY,
                  fontSize: 14,
                  fontWeight: "500",
                  marginBottom: 18,
                }}
              >
                An idea for Harbor House
              </Copy>
              <Copy style={{ color: "#ADBBAF", fontSize: 12, lineHeight: 24 }}>
                Hi Sam,{"\n\n"}We help independent hotels turn website visits
                into more direct bookings.{"\n\n"}Would a short booking-funnel
                review be useful for Harbor House?
              </Copy>
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingVertical: 20,
              }}
            >
              <Send size={15} color={LIME} />
              <Copy style={{ fontSize: 11, color: IVORY }}>
                First message + 3 follow-ups
              </Copy>
            </View>
          </>
        )}
      </View>
      <View
        style={{
          marginTop: 20,
          paddingTop: 16,
          borderTopWidth: 1,
          borderColor: "#29362E",
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <Copy style={{ color: "#8F9F92", fontSize: 9 }}>
          Illustrative product preview · sample data
        </Copy>
        <ArrowUpRight size={13} color={LIME} />
      </View>
    </View>
  );
}

const styles = (c: any, mobile: boolean, tiny: boolean) =>
  StyleSheet.create({
    header: {
      backgroundColor: c.bg,
      borderBottomWidth: 1,
      borderColor: c.border,
    },
    headerInner: {
      width: "100%",
      maxWidth: 1240,
      alignSelf: "center",
      paddingHorizontal: mobile ? 20 : 40,
      height: 80,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    row: { flexDirection: "row", alignItems: "center", gap: 9 },
    between: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 14,
    },
    mobileMenu: {
      position: "absolute",
      top: 79,
      left: 0,
      right: 0,
      padding: 22,
      borderBottomWidth: 1,
      gap: 9,
    },
    heroSection: {
      width: "100%",
      maxWidth: 1240,
      alignSelf: "center",
      paddingHorizontal: mobile ? 22 : 40,
      paddingTop: mobile ? 42 : 75,
    },
    heroGrid: {
      flexDirection: mobile ? "column" : "row",
      alignItems: "center",
      gap: mobile ? 42 : 50,
    },
    h1: {
      fontSize: tiny ? 40 : mobile ? 54 : 62,
      lineHeight: tiny ? 48 : mobile ? 63 : 71,
      fontWeight: "500",
      letterSpacing: tiny ? -1.7 : -2.8,
      color: c.text,
      marginTop: 25,
      marginBottom: 22,
    },
    h2: {
      fontSize: tiny ? 31 : mobile ? 36 : 42,
      lineHeight: tiny ? 39 : mobile ? 45 : 51,
      letterSpacing: -1.5,
      fontWeight: "500",
      color: c.text,
    },
    h3: {
      fontSize: 27,
      lineHeight: 35,
      letterSpacing: -0.7,
      fontWeight: "500",
      color: c.text,
      marginTop: 17,
      marginBottom: 16,
    },
    body: { fontSize: 14, lineHeight: 25, color: c.muted },
    audienceBar: {
      paddingVertical: 34,
      marginTop: 55,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: c.border,
      gap: 20,
      alignItems: "center",
    },
    section: {
      width: "100%",
      maxWidth: 1240,
      alignSelf: "center",
      paddingHorizontal: mobile ? 22 : 40,
      paddingTop: mobile ? 62 : 85,
      paddingBottom: mobile ? 5 : 10,
    },
    split: { flexDirection: mobile ? "column" : "row", gap: 20 },
    featureCard: {
      padding: mobile ? 24 : 30,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.panel,
      borderRadius: 13,
    },
    featureIcon: {
      width: 48,
      height: 48,
      borderRadius: 13,
      backgroundColor: c.raised,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 22,
    },
    cardKicker: {
      fontSize: 9,
      letterSpacing: 1.5,
      color: c.muted,
      fontWeight: "600",
    },
    queryCard: { backgroundColor: "#0A100F", borderRadius: 9, padding: 22 },
    sequenceFeature: {
      flexDirection: mobile ? "column" : "row",
      gap: mobile ? 28 : 45,
      padding: mobile ? 24 : 36,
    },
    sequenceCard: {
      padding: mobile ? 20 : 25,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
    },
    workflowBand: { backgroundColor: "#EDF2E6", marginTop: mobile ? 65 : 90 },
    workflowInner: {
      width: "100%",
      maxWidth: 1240,
      alignSelf: "center",
      paddingHorizontal: mobile ? 22 : 40,
      paddingVertical: mobile ? 48 : 70,
    },
    mailFeature: {
      flexDirection: mobile ? "column" : "row",
      gap: mobile ? 32 : 80,
      alignItems: mobile ? "stretch" : "center",
    },
    mailCard: {
      padding: mobile ? 22 : 30,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.panel,
      borderRadius: 13,
    },
    faqGrid: {
      flexDirection: mobile ? "column" : "row",
      gap: mobile ? 30 : 75,
      paddingTop: mobile ? 42 : 65,
    },
    finalCta: {
      padding: mobile ? 28 : 44,
      backgroundColor: LIME,
      borderRadius: 15,
      position: "relative",
      overflow: "hidden",
    },
    footer: {
      width: "100%",
      maxWidth: 1160,
      alignSelf: "center",
      paddingHorizontal: mobile ? 22 : 0,
      paddingTop: 50,
      marginTop: 45,
      paddingBottom: 25,
      borderTopWidth: 1,
      borderColor: c.border,
      flexDirection: mobile ? "column" : "row",
      alignItems: mobile ? "flex-start" : "center",
      justifyContent: "space-between",
      gap: 30,
    },
    notice: {
      padding: 18,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
      marginBottom: 25,
      backgroundColor: c.panel,
    },
  });
