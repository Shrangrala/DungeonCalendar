import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import { auth, db, storage, onAuthStateChanged, signInToFirebaseWithGoogleIdToken, signOut } from "./firebase";
import { collection, deleteDoc, doc, enableNetwork, onSnapshot, serverTimestamp, setDoc, onSnapshotsInSync } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import * as ImagePicker from "expo-image-picker";

const WEB_CLIENT_ID = "1089961645011-3ts4dr2p473lnobgch0k5p7abk5rbeu9.apps.googleusercontent.com";

GoogleSignin.configure({
  webClientId: WEB_CLIENT_ID,
  offlineAccess: false,
});

const COLORS = {
  bg: "#050505",
  panel: "rgba(14, 14, 14, 0.98)",
  panel2: "rgba(22, 22, 22, 0.98)",
  border: "#2a2a2a",
  red: "#dc2626",
  redDark: "#991b1b",
  gold: "#f4c76a",
  white: "#f8fafc",
  muted: "#a1a1aa",
  green: "#22c55e",
  blue: "#60a5fa",
  amber: "#f59e0b",
};

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function makeId(prefix = "item") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyToParts(key = "") {
  const date = new Date(`${key}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { month: "---", day: "--", weekday: "---", label: key || "No date" };
  return {
    month: date.toLocaleString(undefined, { month: "short" }).toUpperCase(),
    day: String(date.getDate()).padStart(2, "0"),
    weekday: date.toLocaleString(undefined, { weekday: "short" }).toUpperCase(),
    label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    full: date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
  };
}

function normalizeList(values = []) {
  return Array.isArray(values) ? Array.from(new Set(values.filter(Boolean).map(String))) : [];
}

function getSingleDungeonMasterId(campaign = {}, fallbackId = "") {
  const candidates = [
    campaign.dungeonMasterId,
    campaign.dmId,
    campaign.ownerId,
    campaign.createdBy,
    ...(Array.isArray(campaign.dungeonMasterIds) ? campaign.dungeonMasterIds : []),
    fallbackId
  ].filter(Boolean).map(String);
  return candidates[0] || "";
}

function normalizeCampaign(campaign = {}) {
  const id = campaign.id || makeId("campaign");
  const dungeonMasterId = getSingleDungeonMasterId(campaign, campaign.ownerId || "");
  return {
    ...campaign,
    id,
    name: campaign.name || "Untitled Campaign",
    ownerId: dungeonMasterId || campaign.ownerId || "",
    dungeonMasterId: dungeonMasterId || campaign.ownerId || "",
    dmId: dungeonMasterId || campaign.ownerId || "",
    dungeonMasterIds: (dungeonMasterId || campaign.ownerId) ? [dungeonMasterId || campaign.ownerId] : [],
    memberIds: normalizeList(campaign.memberIds || campaign.playerIds || campaign.members),
    invitedEmails: normalizeList(campaign.invitedEmails).map(normalizeEmail).filter(Boolean),
    invitedPlayers: Array.isArray(campaign.invitedPlayers) ? campaign.invitedPlayers : [],
    availability: campaign.availability || {},
    unavailable: campaign.unavailable || {},
    chosenDate: campaign.chosenDate || "",
    generatedSessionDates: normalizeList(campaign.generatedSessionDates || []),
    manuallySelectedDates: normalizeList(campaign.manuallySelectedDates || []),
    sessionTime: campaign.sessionTime || "18:00",
    sessionDuration: Number(campaign.sessionDuration || 4),
    reminderHours: Number(campaign.reminderHours || 24),
    level: campaign.level || campaign.campaignLevel || "",
    defaultLocation: campaign.defaultLocation || campaign.location || "",
  };
}

function visibleToUser(campaign, user) {
  if (!user) return false;
  const uid = user.uid;
  const email = normalizeEmail(user.email || user.providerData?.[0]?.email || "");
  return (
    campaign.ownerId === uid ||
    campaign.dungeonMasterIds?.includes(uid) ||
    campaign.memberIds?.includes(uid) ||
    campaign.invitedPlayers?.some((p) => p.id === uid || p.uid === uid || normalizeEmail(p.email) === email) ||
    (!!email && campaign.invitedEmails?.includes(email))
  );
}

function getFirebaseUserProfile(user) {
  const displayName = user?.displayName || user?.providerData?.[0]?.displayName || "Dungeon Calendar User";
  const email = user?.email || user?.providerData?.[0]?.email || "No email connected";
  const avatar = user?.photoURL || user?.providerData?.[0]?.photoURL || null;
  return { displayName, email, avatar };
}

function playerFromFirebaseUser(user, activeCampaignId = "") {
  const profile = getFirebaseUserProfile(user);
  return {
    id: user?.uid || "current-user",
    name: profile.displayName,
    email: profile.email,
    role: "Player",
    campaignIds: activeCampaignId ? [activeCampaignId] : [],
    campaignCharacterNames: {},
    color: COLORS.green,
    status: "Active",
  };
}

function campaignPlayerRecord(player = {}, campaignId = "") {
  const email = normalizeEmail(player.email || "");
  return {
    id: player.id || player.uid || email || makeId("player"),
    name: player.name || player.displayName || player.username || email || "Player",
    email,
    role: player.role || "Player",
    campaignIds: Array.from(new Set([...(player.campaignIds || []), campaignId].filter(Boolean))),
    campaignCharacterNames: player.campaignCharacterNames || (campaignId ? { [campaignId]: player.characterName || "" } : {}),
    color: player.color || COLORS.green,
    invitePending: player.invitePending !== false,
  };
}

function campaignPlayers(campaign, user) {
  if (!campaign) return user ? [playerFromFirebaseUser(user)] : [];
  const byKey = new Map();
  const add = (player) => {
    const record = campaignPlayerRecord(player, campaign.id);
    const key = normalizeEmail(record.email) || record.id;
    byKey.set(key, { ...(byKey.get(key) || {}), ...record });
  };
  if (user) add({ ...playerFromFirebaseUser(user, campaign.id), role: campaign.dungeonMasterIds?.includes(user.uid) ? "Dungeon Master" : "Player" });
  (campaign.invitedPlayers || []).forEach(add);
  (campaign.memberIds || []).forEach((id) => add({ id, name: id === user?.uid ? getFirebaseUserProfile(user).displayName : "Campaign Member" }));
  (campaign.invitedEmails || []).forEach((email) => add({ email, name: email, invitePending: true }));
  return Array.from(byKey.values());
}

function proposedDatesForCampaign(campaign) {
  if (!campaign) return [];
  const dmIds = new Set([campaign.ownerId, ...(campaign.dungeonMasterIds || [])].filter(Boolean));
  const dmProposedFromAvailability = Object.entries(campaign.availability || {})
    .filter(([, ids]) => Array.isArray(ids) && ids.some((id) => dmIds.has(id)))
    .map(([key]) => key);
  const keys = Array.from(new Set([
    ...(campaign.manuallySelectedDates || []),
    ...(campaign.generatedSessionDates || []),
    ...dmProposedFromAvailability,
    campaign.chosenDate,
  ].filter(Boolean))).sort();
  return keys.map((key) => {
    const parts = dateKeyToParts(key);
    return {
      key,
      ...parts,
      available: (campaign.availability?.[key] || []).length,
      unavailable: (campaign.unavailable?.[key] || []).length,
      status: campaign.chosenDate === key ? "selected" : "proposed",
    };
  });
}

function userIsDungeonMaster(user, campaign) {
  if (!user || !campaign) return false;
  return campaign.ownerId === user.uid || campaign.dungeonMasterIds?.includes(user.uid);
}

async function saveCampaign(campaign) {
  if (!campaign?.id) return;
  await enableNetwork(db).catch(() => {});
  await setDoc(doc(db, "campaigns", campaign.id), {
    ...normalizeCampaign(campaign),
    updatedAt: new Date().toISOString(),
    updatedAtServer: serverTimestamp(),
  }, { merge: true });
}

async function deleteCampaignById(id) {
  if (!id) return;
  await enableNetwork(db).catch(() => {});
  await deleteDoc(doc(db, "campaigns", id));
}

const planOrder = ["free", "adventurer", "guildmaster"];

function normalizePlan(planId = "free") {
  const value = String(planId || "free").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (["guildmaster", "guild", "guildmasterplan", "guildplan"].includes(value)) return "guildmaster";
  if (["adventurer", "adventure", "adventurerplan", "adventureplan"].includes(value)) return "adventurer";
  if (["free", "freeplan", "basic", "starter"].includes(value)) return "free";
  return "free";
}

function readProfilePlan(profile = {}, fallback = "free") {
  const planValue =
    profile.plan ??
    profile.Plan ??
    profile.planStatus ??
    profile.PlanStatus ??
    profile.subscriptionPlan ??
    profile.SubscriptionPlan ??
    profile.membershipPlan ??
    profile.MembershipPlan ??
    profile.accountPlan ??
    profile.AccountPlan ??
    profile.tier ??
    profile.Tier ??
    fallback;

  return normalizePlan(planValue);
}

function normalizeBillingInterval(interval = "monthly") {
  return ["monthly", "yearly"].includes(interval) ? interval : "monthly";
}

const planLimits = {
  free: { name: "Free", campaigns: 1, monthlyPrice: 0, yearlyPrice: 0 },
  adventurer: { name: "Adventurer", campaigns: 5, monthlyPrice: 2.99, yearlyPrice: 29.99 },
  guildmaster: { name: "Guildmaster", campaigns: Infinity, monthlyPrice: 4.99, yearlyPrice: 49.99 },
};

const planFeatures = {
  free: { autoPick: false, calendarExport: false, fullTracking: false, playerInvites: true, advancedManagement: false, tokenUploads: false },
  adventurer: { autoPick: true, calendarExport: true, fullTracking: false, playerInvites: true, advancedManagement: false, tokenUploads: false },
  guildmaster: { autoPick: true, calendarExport: true, fullTracking: true, playerInvites: true, advancedManagement: true, tokenUploads: true },
};

const stripePaymentLinks = {
  adventurer: {
    monthly: "https://buy.stripe.com/3cI9ATfnI69nayf91I6Ri07",
    yearly: "https://buy.stripe.com/bJe28r1wS55jdKr4Ls6Ri06",
  },
  guildmaster: {
    monthly: "https://buy.stripe.com/6oU28r8Zk41fayffq66Ri05",
    yearly: "https://buy.stripe.com/28E9AT8ZkeFT0XF5Pw6Ri04",
  },
};

function formatPlanPrice(planId, interval = "monthly") {
  const safePlan = normalizePlan(planId);
  if (safePlan === "free") return "$0";
  const planInfo = planLimits[safePlan];
  const amount = interval === "yearly" ? planInfo.yearlyPrice : planInfo.monthlyPrice;
  return `$${Number(amount).toFixed(2)}${interval === "yearly" ? "/year" : "/month"}`;
}

function yearlySavingsLabel(planId) {
  const safePlan = normalizePlan(planId);
  if (safePlan === "free") return "";
  const info = planLimits[safePlan];
  const savings = (info.monthlyPrice * 12) - info.yearlyPrice;
  return savings > 0 ? `or $${info.yearlyPrice.toFixed(2)}/year — save $${savings.toFixed(2)}` : `or $${info.yearlyPrice.toFixed(2)}/year`;
}

function getPlanRank(planId) {
  return planOrder.indexOf(normalizePlan(planId));
}

function hasPlanFeature(planId, feature) {
  return !!planFeatures[normalizePlan(planId)]?.[feature];
}


function buildCalendarExportUrls(campaign, dateKey) {
  if (!campaign || !dateKey) return null;
  const start = new Date(`${dateKey}T${campaign.sessionTime || "18:00"}:00`);
  const end = new Date(start.getTime() + Number(campaign.sessionDuration || 4) * 60 * 60 * 1000);
  const title = `${campaign.name || "Dungeon Calendar"} Session`;
  const details = `Dungeon Calendar session for ${campaign.name || "campaign"}.`;
  const toGoogleDate = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${toGoogleDate(start)}/${toGoogleDate(end)}&details=${encodeURIComponent(details)}`;
  const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(title)}&startdt=${encodeURIComponent(start.toISOString())}&enddt=${encodeURIComponent(end.toISOString())}&body=${encodeURIComponent(details)}`;
  return { googleUrl, outlookUrl };
}

async function saveUserSettings(user, settings) {
  if (!user?.uid) return;
  await enableNetwork(db).catch(() => {});
  await setDoc(doc(db, "users", user.uid), {
    ...settings,
    updatedAtServer: serverTimestamp(),
  }, { merge: true });
}

function getPlanActionLabel(currentPlan, planId) {
  const active = normalizePlan(currentPlan);
  const target = normalizePlan(planId);
  if (target === active) return "Active";
  return getPlanRank(target) > getPlanRank(active) ? `Upgrade to ${planLimits[target].name}` : `Downgrade to ${planLimits[target].name}`;
}

const planCards = [
  {
    id: "free",
    name: "Free",
    description: "Perfect for casual adventurers trying out the app for their first campaign.",
    features: ["Create 1 campaign", "Unlimited invited campaigns", "Unlimited invited character roles", "Shared scheduling calendar", "Session reminders", "Player invite tools", "Manual final date selection"],
  },
  {
    id: "adventurer",
    name: "Adventurer",
    description: "Built for active players juggling multiple parties, characters, and weekly sessions.",
    features: ["Create up to 5 campaigns", "Unlimited invited campaigns", "Unlimited invited character roles", "Shared scheduling calendar", "Session reminders", "Player invite tools", "Manual final date selection", "Automatic best-date voting", "Calendar export support"],
  },
  {
    id: "guildmaster",
    name: "Guildmaster",
    description: "The ultimate toolkit for dedicated Dungeon Masters and large gaming groups.",
    features: ["Unlimited campaign creation", "Unlimited invited campaigns", "Unlimited invited character roles", "Shared scheduling calendar", "Session reminders", "Player invite tools", "Manual final date selection", "Automatic best-date voting", "Calendar export support", "Full party availability tracking", "Advanced campaign controls", "Custom player token image uploads", "Priority access to future premium features"],
  },
];

function Icon({ children, color = COLORS.red }) {
  return <Text style={[styles.icon, { color }]}>{children}</Text>;
}

function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function Header({ title, subtitle, onSettings }) {
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Image source={require("./assets/dungeon-calendar-logo.png")} style={styles.logo} resizeMode="contain" />
        <View style={styles.brandCopy}>
          <Text style={styles.brandGold}>Dungeon</Text>
          <Text style={styles.brandGold}>Calendar</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.cogButton} onPress={onSettings} activeOpacity={0.84}>
        <Text style={styles.cogText}>⚙</Text>
      </TouchableOpacity>

      <Text style={styles.pageTitle}>{title}</Text>
      {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function Screen({ children }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function LoginScreen({ onGoogleLogin, onEmailLogin, authError }) {
  return (
    <SafeAreaView style={styles.loginScreen}>
      <Image source={require("./assets/dungeon-calendar-logo.png")} style={styles.loginLogo} resizeMode="contain" />
      <Text style={styles.loginTitle}>Dungeon Calendar</Text>
      <Text style={styles.loginSubtitle}>Plan. Play. Remember.</Text>
      <TouchableOpacity style={styles.primaryButton} onPress={onGoogleLogin}>
        <Text style={styles.primaryButtonText}>Continue with Google</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={onEmailLogin}>
        <Text style={styles.secondaryButtonText}>Continue with Email</Text>
      </TouchableOpacity>
      {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
      <Text style={styles.legalText}>By continuing, you agree to our Terms of Service and Privacy Policy.</Text>
    </SafeAreaView>
  );
}

function CampaignSelector({ campaigns = [], activeCampaign, setSelectedCampaignId }) {
  if (!campaigns.length) {
    return (
      <View style={styles.selector}>
        <Text style={styles.selectorIcon}>⚜</Text>
        <Text style={styles.selectorText}>No campaigns yet</Text>
        <Text style={styles.selectorPlan}>Create or accept an invite on the main app</Text>
      </View>
    );
  }
  return (
    <View style={styles.selector}>
      <Text style={styles.selectorIcon}>⚜</Text>
      <Text style={styles.selectorText}>{activeCampaign?.name || campaigns[0]?.name}</Text>
      <Text style={styles.selectorPlan}>{campaigns.length} linked campaign{campaigns.length === 1 ? "" : "s"}</Text>
      {campaigns.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {campaigns.map((campaign) => (
            <TouchableOpacity key={campaign.id} style={styles.outlineButton} onPress={() => setSelectedCampaignId(campaign.id)}>
              <Text style={styles.outlineButtonText}>{campaign.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
function StatCard({ icon, label, value, color }) {
  return (
    <View style={styles.statCard}>
      <Icon color={color}>{icon}</Icon>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function StatGrid({ children }) {
  return <View style={styles.statsGrid}>{children}</View>;
}

function DateBadge({ month, day, weekday }) {
  return (
    <View style={styles.dateBadge}>
      <Text style={styles.dateMonth}>{month}</Text>
      <Text style={styles.dateDay}>{day}</Text>
      <Text style={styles.dateWeekday}>{weekday}</Text>
    </View>
  );
}

function Dashboard({ navigate, openSettings, user, campaigns = [], activeCampaign, activePlayers = [], proposedDates = [], isDungeonMaster, setSelectedCampaignId }) {
  const profile = getFirebaseUserProfile(user);
  const chosen = activeCampaign?.chosenDate ? dateKeyToParts(activeCampaign.chosenDate) : null;
  const nextDate = chosen || proposedDates[0] || null;
  return (
    <Screen>
      <Header title="Welcome back," subtitle={profile.displayName} onSettings={openSettings} />
      <CampaignSelector campaigns={campaigns} activeCampaign={activeCampaign} setSelectedCampaignId={setSelectedCampaignId} />

      <StatGrid>
        <StatCard icon="▣" label="Campaigns" value={String(campaigns.length)} color={COLORS.red} />
        <StatCard icon="♟" label="Players" value={String(activePlayers.length)} color={COLORS.green} />
        <StatCard icon="▥" label="Dates" value={String(proposedDates.length)} color={COLORS.blue} />
        <StatCard icon="◇" label="Role" value={isDungeonMaster ? "DM" : "Player"} color={COLORS.gold} />
      </StatGrid>

      <Card>
        <View style={styles.sectionHeader}>
          <View style={styles.inlineTitle}>
            <Icon>▣</Icon>
            <Text style={styles.sectionTitle}>Upcoming Session</Text>
          </View>
          <TouchableOpacity style={styles.outlineButton} onPress={() => navigate("results") }>
            <Text style={styles.outlineButtonText}>View Results</Text>
          </TouchableOpacity>
        </View>
        {activeCampaign && nextDate ? (
          <TouchableOpacity style={styles.sessionRow} onPress={() => navigate("session")} activeOpacity={0.85}>
            <DateBadge month={nextDate.month} day={nextDate.day} weekday={nextDate.weekday} />
            <View style={styles.sessionArt} />
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionTitle}>{activeCampaign.name}</Text>
              <Text style={styles.sessionText}>{nextDate.full || `${nextDate.label}`}</Text>
              <Text style={styles.sessionAccent}>{nextDate.available || 0} available · {nextDate.unavailable || 0} unavailable</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.helperText}>No session dates have been created for your linked campaigns yet.</Text>
        )}
        <TouchableOpacity style={styles.primaryButton} onPress={() => navigate(activeCampaign ? "calendar" : "campaigns") }>
          <Text style={styles.primaryButtonText}>{activeCampaign ? "Open Calendar" : "Open Campaigns"}</Text>
        </TouchableOpacity>
      </Card>

      <Card>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Calendar Overview</Text>
          <TouchableOpacity style={styles.outlineButton} onPress={() => navigate("calendar") }>
            <Text style={styles.outlineButtonText}>Open Calendar</Text>
          </TouchableOpacity>
        </View>
        <MiniCalendar compact proposedDates={proposedDates} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickGrid}>
          <QuickAction icon="▣" label={isDungeonMaster ? "Propose Dates" : "Availability"} detail={isDungeonMaster ? "DM only" : "Your response"} onPress={() => navigate("calendar")} />
          <QuickAction icon="▥" label="View Results" detail="Compare dates" onPress={() => navigate("results")} />
          <QuickAction icon="⚙" label="Campaigns" detail="Linked data" onPress={() => navigate("campaigns")} />
        </View>
      </Card>
    </Screen>
  );
}
function QuickAction({ icon, label, detail, onPress }) {
  return (
    <TouchableOpacity style={styles.quickAction} onPress={onPress} activeOpacity={0.85}>
      <Icon>{icon}</Icon>
      <Text style={styles.quickLabel}>{label}</Text>
      <Text style={styles.quickDetail}>{detail}</Text>
    </TouchableOpacity>
  );
}

function MiniCalendar({ compact = false, proposedDates = [], activeCampaign, user, isDungeonMaster, availabilityMode = "available", onDatePress }) {
  const now = proposedDates[0]?.key ? new Date(`${proposedDates[0].key}T00:00:00`) : new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const selectedKeys = new Set(proposedDates.map((d) => d.key));
  const chosenKey = proposedDates.find((d) => d.status === "selected")?.key;
  const currentUserId = user?.uid || "";
  const cells = Array.from({ length: 35 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = localDateKey(date);
    const availableIds = activeCampaign?.availability?.[key] || [];
    const unavailableIds = activeCampaign?.unavailable?.[key] || [];
    const dmAvailable = availableIds.some((id) => activeCampaign?.dungeonMasterIds?.includes(id) || id === activeCampaign?.ownerId);
    return {
      key,
      day: String(date.getDate()),
      inMonth: date.getMonth() === month,
      availableIds,
      unavailableIds,
      dmAvailable,
      availableByUser: availableIds.includes(currentUserId),
      unavailableByUser: unavailableIds.includes(currentUserId),
    };
  });
  const names = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return (
    <View>
      <Text style={styles.calendarTitle}>{now.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</Text>
      <View style={styles.calendarGrid}>
        {names.map((n) => <Text key={n} style={styles.dayName}>{n}</Text>)}
        {cells.map((cell) => {
          const proposed = selectedKeys.has(cell.key);
          const selected = chosenKey === cell.key;
          const disabled = !activeCampaign || (!isDungeonMaster && !cell.dmAvailable);
          const userMarked = cell.availableByUser || cell.unavailableByUser;
          return (
            <TouchableOpacity
              key={cell.key}
              activeOpacity={disabled ? 1 : 0.75}
              disabled={disabled}
              onPress={() => onDatePress?.(cell.key)}
              style={[
                styles.dayCell,
                compact ? styles.dayCellCompact : null,
                selected ? styles.selectedDay : proposed ? styles.proposedDay : null,
                cell.availableByUser ? styles.availableDay : null,
                cell.unavailableByUser ? styles.unavailableDay : null,
                disabled ? styles.disabledDay : null,
              ]}
            >
              <Text style={[styles.dayNum, compact ? styles.dayNumCompact : null, selected || userMarked ? styles.activeDayText : null, !cell.inMonth ? { color: "#52525b" } : null]}>{cell.day}</Text>
              {proposed ? <View style={[styles.eventDot, selected ? styles.goldDot : cell.unavailableByUser ? styles.redDot : null]} /> : null}
              {cell.dmAvailable && !isDungeonMaster ? <Text style={styles.dmOpenText}>DM</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: COLORS.blue }]} /><Text style={styles.legendText}>Proposed</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: COLORS.green }]} /><Text style={styles.legendText}>Available</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: COLORS.red }]} /><Text style={styles.legendText}>Unavailable</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: COLORS.gold }]} /><Text style={styles.legendText}>Chosen</Text></View>
      </View>
      {!isDungeonMaster ? <Text style={styles.helperText}>Players can only mark dates after the DM proposes/marks them available, matching the web app.</Text> : null}
    </View>
  );
}
function CalendarScreen({ navigate, openSettings, user, activeCampaign, proposedDates = [], isDungeonMaster }) {
  const [availabilityMode, setAvailabilityMode] = useState("available");
  const toggleAvailability = async (dateKey, status = availabilityMode) => {
    if (!activeCampaign || !user?.uid) return;
    const available = new Set(activeCampaign.availability?.[dateKey] || []);
    const unavailable = new Set(activeCampaign.unavailable?.[dateKey] || []);
    const manualDates = new Set(activeCampaign.manuallySelectedDates || []);
    const dmIds = new Set([activeCampaign.ownerId, ...(activeCampaign.dungeonMasterIds || [])].filter(Boolean));
    const dmProposed = manualDates.has(dateKey) || (activeCampaign.generatedSessionDates || []).includes(dateKey) || Array.from(available).some((id) => dmIds.has(id));
    if (!isDungeonMaster && !dmProposed) return;
    const isAvailable = available.has(user.uid);
    const isUnavailable = unavailable.has(user.uid);

    if (status === "available") {
      if (isAvailable) {
        available.delete(user.uid);
        if (isDungeonMaster) manualDates.delete(dateKey);
      } else {
        available.add(user.uid);
        unavailable.delete(user.uid);
        if (isDungeonMaster) manualDates.add(dateKey);
      }
    }
    if (status === "unavailable") {
      if (isUnavailable) unavailable.delete(user.uid);
      else { unavailable.add(user.uid); available.delete(user.uid); }
    }
    await saveCampaign({
      ...activeCampaign,
      manuallySelectedDates: Array.from(manualDates),
      availability: { ...(activeCampaign.availability || {}), [dateKey]: Array.from(available) },
      unavailable: { ...(activeCampaign.unavailable || {}), [dateKey]: Array.from(unavailable) },
    });
  };
  const removeDate = async (dateKey) => {
    if (!activeCampaign || !isDungeonMaster) return;
    const availability = { ...(activeCampaign.availability || {}) };
    const unavailable = { ...(activeCampaign.unavailable || {}) };
    delete availability[dateKey];
    delete unavailable[dateKey];
    await saveCampaign({
      ...activeCampaign,
      availability,
      unavailable,
      manuallySelectedDates: (activeCampaign.manuallySelectedDates || []).filter((key) => key !== dateKey),
      generatedSessionDates: (activeCampaign.generatedSessionDates || []).filter((key) => key !== dateKey),
      chosenDate: activeCampaign.chosenDate === dateKey ? "" : activeCampaign.chosenDate,
    });
  };
  const setChosen = async (dateKey) => {
    if (!activeCampaign || !isDungeonMaster) return;
    await saveCampaign({ ...activeCampaign, chosenDate: dateKey });
  };
  return (
    <Screen>
      <Header title="Calendar" subtitle={activeCampaign ? activeCampaign.name : "No linked campaign"} onSettings={openSettings} />
      <Card>
        <View style={styles.sectionHeader}>
          <Text style={styles.calendarTitle}>{activeCampaign?.name || "Campaign Calendar"}</Text>
          {isDungeonMaster ? (
            <TouchableOpacity style={styles.smallRedButton} onPress={() => navigate("proposeDate") }>
              <Text style={styles.smallRedButtonText}>+ Propose Date</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={styles.responseButtons}>
          <TouchableOpacity style={[styles.voteAvailable, availabilityMode === "available" ? styles.voteSelected : null]} onPress={() => setAvailabilityMode("available")}>
            <Text style={styles.voteButtonText}>Available</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.voteUnavailable, availabilityMode === "unavailable" ? styles.voteSelected : null]} onPress={() => setAvailabilityMode("unavailable")}>
            <Text style={styles.voteButtonText}>Not Available</Text>
          </TouchableOpacity>
        </View>
        <MiniCalendar proposedDates={proposedDates} activeCampaign={activeCampaign} user={user} isDungeonMaster={isDungeonMaster} availabilityMode={availabilityMode} onDatePress={(key) => toggleAvailability(key, availabilityMode)} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>{isDungeonMaster ? "Proposed Session Dates" : "Your Availability"}</Text>
        <Text style={styles.helperText}>{activeCampaign ? "Synced with Firebase and the main web app." : "Join or create a campaign on the main app first."}</Text>
        {proposedDates.length ? proposedDates.map((d) => (
          <AvailabilityDateRow key={d.key} date={d} navigate={navigate} isDungeonMaster={isDungeonMaster} onAvailable={() => toggleAvailability(d.key, "available")} onUnavailable={() => toggleAvailability(d.key, "unavailable")} onRemove={() => removeDate(d.key)} onSetChosen={() => setChosen(d.key)} />
        )) : <Text style={styles.helperText}>No dates have been proposed yet.</Text>}
      </Card>
    </Screen>
  );
}
function AvailabilityDateRow({ date, navigate, isDungeonMaster, onAvailable, onUnavailable, onRemove, onSetChosen }) {
  return (
    <TouchableOpacity style={styles.availabilityRow} onPress={() => navigate("results")} activeOpacity={0.86}>
      <DateBadge month={date.month} day={date.day} weekday={date.weekday} />
      <View style={styles.eventInfo}>
        <Text style={styles.sessionTitle}>{date.full || `${date.label}`}</Text>
        <Text style={styles.sessionText}>{date.available} available · {date.unavailable} unavailable</Text>
        <View style={styles.responseButtons}>
          {isDungeonMaster ? (
            <>
              <TouchableOpacity style={[styles.voteButton, date.status === "selected" ? styles.voteSelected : null]} onPress={onSetChosen}>
                <Text style={styles.voteButtonText}>{date.status === "selected" ? "Chosen Date" : "Set as Chosen"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.voteButtonMuted} onPress={onRemove}>
                <Text style={styles.voteMutedText}>Delete Date</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={styles.voteAvailable} onPress={onAvailable}><Text style={styles.voteButtonText}>Available</Text></TouchableOpacity>
              <TouchableOpacity style={styles.voteUnavailable} onPress={onUnavailable}><Text style={styles.voteButtonText}>Unavailable</Text></TouchableOpacity>
            </>
          )}
        </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}
function Campaigns({ navigate, openSettings, campaigns = [], activeCampaign, setSelectedCampaignId, isDungeonMaster, plan, user }) {
  const deleteCampaign = (campaign) => {
    if (!campaign) return;
    Alert.alert("Delete Campaign", `Delete ${campaign.name}? This also removes it from Firebase.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteCampaignById(campaign.id) },
    ]);
  };
  return (
    <Screen>
      <Header title="Campaigns" subtitle="Only campaigns you created or joined" onSettings={openSettings} />
      <View style={styles.searchRow}>
        <Text style={styles.searchText}>Firebase-linked campaigns</Text>
        {isDungeonMaster ? <TouchableOpacity style={styles.smallRedButton} onPress={() => { const ownedCount = campaigns.filter((c) => userIsDungeonMaster(user, c)).length; const limit = planLimits[normalizePlan(plan)].campaigns; if (ownedCount >= limit) { Alert.alert("Plan Limit", `${planLimits[normalizePlan(plan)].name} allows ${limit === Infinity ? "unlimited" : limit} campaign creation. Upgrade to create more campaigns.`); navigate("plan"); return; } navigate("campaignEditor"); }}><Text style={styles.smallRedButtonText}>+ Add Campaign</Text></TouchableOpacity> : null}
      </View>
      {campaigns.length ? campaigns.map((c) => {
        const dm = c.ownerId || c.dungeonMasterIds?.[0] || "DM";
        const next = c.chosenDate ? dateKeyToParts(c.chosenDate).full : (proposedDatesForCampaign(c)[0]?.full || "No date selected");
        return (
          <TouchableOpacity key={c.id} activeOpacity={0.86} onPress={() => { setSelectedCampaignId(c.id); navigate("campaignDetail"); }}>
            <Card style={styles.campaignCard}>
              <View style={[styles.campaignArt, { backgroundColor: c.color || "#3b0764" }]} />
              <View style={styles.campaignInfo}>
                <Text style={styles.campaignTitle}>{c.name}</Text>
                <Text style={styles.sessionText}>{c.level || "Campaign"}</Text>
                <Text style={styles.sessionText}>Next Session: {next}</Text>
                <Text style={styles.sessionText}>DM: {dm}</Text>
              </View>
              <View style={styles.badge}><Text style={styles.badgeText}>{activeCampaign?.id === c.id ? "Active" : "Linked"}</Text></View>
              {isDungeonMaster ? <TouchableOpacity style={styles.voteButtonMuted} onPress={() => deleteCampaign(c)}><Text style={styles.voteMutedText}>Delete</Text></TouchableOpacity> : null}
            </Card>
          </TouchableOpacity>
        );
      }) : <Card><Text style={styles.helperText}>No campaigns found for this Firebase account. Create one on the main app or accept an invite.</Text></Card>}
    </Screen>
  );
}
function CampaignDetail({ navigate, openSettings, activeCampaign, isDungeonMaster }) {
  if (!activeCampaign) return <SimpleInfoPage title="Campaign Details" openSettings={openSettings}><Text style={styles.notesText}>No campaign is selected.</Text></SimpleInfoPage>;
  const deleteCurrent = () => Alert.alert("Delete Campaign", `Delete ${activeCampaign.name}?`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { await deleteCampaignById(activeCampaign.id); navigate("campaigns"); } },
  ]);
  return (
    <Screen>
      <Header title="Campaign Details" subtitle={activeCampaign.name} onSettings={openSettings} />
      <Card>
        <View style={styles.detailsHero} />
        <SettingsRow label="Campaign Name" detail={activeCampaign.name} onPress={() => navigate("campaignEditor")} />
        <SettingsRow label="Campaign Level" detail={activeCampaign.level || "Not set"} onPress={() => navigate("campaignEditor")} />
        <SettingsRow label="Dungeon Masters" detail={(activeCampaign.dungeonMasterIds || []).length ? `${activeCampaign.dungeonMasterIds.length} DM(s)` : "Not set"} onPress={() => navigate("campaignEditor")} />
        <SettingsRow label="Players" detail={`${campaignPlayers(activeCampaign).length} linked`} onPress={() => navigate("players")} />
        <TouchableOpacity style={styles.primaryButton} onPress={() => navigate("calendar")}><Text style={styles.primaryButtonText}>Open Calendar</Text></TouchableOpacity>
        {isDungeonMaster ? <TouchableOpacity style={styles.deleteAccountButton} onPress={deleteCurrent}><Text style={styles.deleteAccountText}>Delete Campaign</Text></TouchableOpacity> : null}
      </Card>
    </Screen>
  );
}
function Players({ navigate, openSettings, activePlayers = [], activeCampaign, isDungeonMaster, plan }) {
  const deletePlayer = async (player) => {
    if (!activeCampaign || !isDungeonMaster) return;
    const email = normalizeEmail(player.email || "");
    await saveCampaign({
      ...activeCampaign,
      memberIds: (activeCampaign.memberIds || []).filter((id) => id !== player.id),
      invitedEmails: (activeCampaign.invitedEmails || []).filter((item) => normalizeEmail(item) !== email),
      invitedPlayers: (activeCampaign.invitedPlayers || []).filter((item) => (item.id || item.uid) !== player.id && normalizeEmail(item.email) !== email),
    });
  };
  return (
    <Screen>
      <Header title="Players" subtitle={activeCampaign ? activeCampaign.name : "No selected campaign"} onSettings={openSettings} />
      <StatGrid>
        <StatCard icon="♟" label="Total" value={String(activePlayers.length)} color={COLORS.green} />
        <StatCard icon="▣" label="Available" value="—" color={COLORS.blue} />
        <StatCard icon="◷" label="Unavailable" value="—" color={COLORS.red} />
        <StatCard icon="◇" label="Pending" value={String(activePlayers.filter((p) => p.invitePending).length)} color={COLORS.gold} />
      </StatGrid>
      <Text style={styles.searchText}>Actual campaign users/invites from Firebase</Text>
      <Card>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Player List</Text>
          {isDungeonMaster ? <View style={styles.inlineActions}><TouchableOpacity style={styles.outlineButton} onPress={() => navigate("playerEditor")}><Text style={styles.outlineButtonText}>+ Add Player</Text></TouchableOpacity><TouchableOpacity style={styles.outlineButton} onPress={() => hasPlanFeature(plan, "tokenUploads") ? navigate("tokens") : navigate("plan")}><Text style={styles.outlineButtonText}>Tokens</Text></TouchableOpacity></View> : null}
        </View>
        {activePlayers.length ? activePlayers.map((p) => (
          <View key={`${p.id}-${p.email}`} style={styles.playerRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{String(p.name || p.email || "P")[0]}</Text></View>
            <View style={styles.playerInfo}>
              <Text style={styles.campaignTitle}>{p.name || p.email}</Text>
              <Text style={styles.sessionText}>{p.email || p.role}</Text>
              <Text style={[styles.sessionAccent, { color: p.invitePending ? COLORS.gold : COLORS.green }]}>{p.invitePending ? "Invited" : (p.role || "Player")}</Text>
            </View>
            {isDungeonMaster ? <TouchableOpacity style={styles.voteButtonMuted} onPress={() => deletePlayer(p)}><Text style={styles.voteMutedText}>Delete</Text></TouchableOpacity> : null}
          </View>
        )) : <Text style={styles.helperText}>No players are linked to this campaign yet.</Text>}
      </Card>
      <Card style={styles.quickAvailability}>
        <View>
          <Text style={styles.sectionTitle}>Quick Availability</Text>
          <Text style={styles.sessionText}>Update your proposed-date responses</Text>
        </View>
        <TouchableOpacity style={styles.primaryButtonSmall} onPress={() => navigate("availability")}><Text style={styles.primaryButtonText}>Update</Text></TouchableOpacity>
      </Card>
    </Screen>
  );
}
function Results({ navigate, openSettings, activeCampaign, proposedDates = [], plan }) {
  const best = [...proposedDates].sort((a, b) => (b.available - b.unavailable) - (a.available - a.unavailable))[0];
  return (
    <Screen>
      <Header title="Results" subtitle={activeCampaign ? activeCampaign.name : "Compare proposed session dates"} onSettings={openSettings} />
      <Card>
        <Text style={styles.sectionTitle}>Availability Results</Text>
        {proposedDates.length ? proposedDates.map((d) => (
          <View key={d.key} style={styles.resultRow}>
            <Icon>▥</Icon>
            <View style={styles.resultInfo}>
              <Text style={styles.resultName}>{d.full || d.label}</Text>
              <Text style={styles.resultMeta}>{d.available} available · {d.unavailable} unavailable</Text>
            </View>
            <View style={styles.resultTotal}><Text style={styles.resultTotalText}>{d.status === "selected" ? "Chosen" : "View"}</Text></View>
          </View>
        )) : <Text style={styles.helperText}>No availability results yet.</Text>}
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>Auto Pick Best Date</Text>
        <Text style={styles.helperText}>{hasPlanFeature(plan, "autoPick") ? "The best date is chosen from proposed dates using player availability responses." : "Automatic best-date voting is included with Adventurer and Guildmaster plans."}</Text>
        {best ? <TouchableOpacity style={hasPlanFeature(plan, "autoPick") ? styles.primaryButton : styles.outlineWideButton} onPress={() => hasPlanFeature(plan, "autoPick") ? navigate("session") : navigate("plan")}><Text style={hasPlanFeature(plan, "autoPick") ? styles.primaryButtonText : styles.outlineButtonText}>{hasPlanFeature(plan, "autoPick") ? `Best: ${best.full || best.label}` : "Upgrade Plan"}</Text></TouchableOpacity> : null}
      </Card>
    </Screen>
  );
}
function SessionDetails({ navigate, openSettings, activeCampaign, proposedDates = [], activePlayers = [], plan }) {
  const chosen = activeCampaign?.chosenDate ? proposedDates.find((d) => d.key === activeCampaign.chosenDate) : proposedDates[0];
  const calendarEvent = buildCalendarExportUrls(activeCampaign, chosen?.key);
  const canExport = hasPlanFeature(plan, "calendarExport");
  return (
    <Screen>
      <Header title="Session Details" subtitle={activeCampaign?.name || "No selected campaign"} onSettings={openSettings} />
      <Card>
        <View style={styles.detailsHero} />
        <Text style={styles.detailsTitle}>{activeCampaign?.name || "Campaign Session"}</Text>
        <Text style={styles.sessionText}>Chosen from DM-proposed availability dates</Text>
        <InfoLine icon="▣" text={chosen?.full || "No date selected"} />
        <InfoLine icon="◷" text={`${activeCampaign?.sessionTime || "18:00"} · ${activeCampaign?.sessionDuration || 4} hours`} />
        <InfoLine icon="♟" text={`${chosen?.available || 0} available · ${chosen?.unavailable || 0} unavailable · ${activePlayers.length} players`} />
        <InfoLine icon="⌖" text={activeCampaign?.defaultLocation || "Location not set"} />
        <Text style={styles.listHeading}>Notes</Text>
        <Text style={styles.notesText}>This session information is synced from the same Firebase campaign used by the main web app.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => navigate("calendar")}><Text style={styles.primaryButtonText}>Open Calendar</Text></TouchableOpacity>
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>Calendar Links</Text>
        {canExport && calendarEvent ? (
          <>
            <TouchableOpacity style={styles.outlineWideButton} onPress={() => Linking.openURL(calendarEvent.googleUrl)}><Text style={styles.outlineButtonText}>Add to Google Calendar</Text></TouchableOpacity>
            <TouchableOpacity style={styles.outlineWideButton} onPress={() => Linking.openURL(calendarEvent.outlookUrl)}><Text style={styles.outlineButtonText}>Add to Outlook Calendar</Text></TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.outlineWideButton} onPress={() => navigate("plan")}><Text style={styles.outlineButtonText}>Calendar export requires Adventurer or Guildmaster</Text></TouchableOpacity>
        )}
      </Card>
    </Screen>
  );
}
function InfoLine({ icon, text }) {
  return <View style={styles.infoLine}><Icon color={COLORS.gold}>{icon}</Icon><Text style={styles.infoText}>{text}</Text></View>;
}

function UserSettings({ navigate, openSettings, openDeleteAccount, handleLogout, plan }) {
  return (
    <Screen>
      <Header title="User Settings" subtitle="Account and app settings" onSettings={openSettings} />
      <Card>
        <Text style={styles.sectionTitle}>Account</Text>
        <SettingsRow label="Profile Information" detail="Name, email, avatar" onPress={() => navigate("profile")} />
        <SettingsRow label="Notifications" detail="Session reminders and invite updates" onPress={() => navigate("notifications")} />
        <SettingsRow label="Campaign Settings" detail="Default campaign and session settings" onPress={() => navigate("campaignSettings")} />
        <SettingsRow label="Plan Settings" detail={`${planLimits[normalizePlan(plan)].name} Plan`} onPress={() => navigate("plan")} />
        <SettingsRow label="Privacy Policy" detail="View privacy information" onPress={() => navigate("privacy")} />
        <SettingsRow label="Terms of Service" detail="View terms" onPress={() => navigate("terms")} />
        <SettingsRow label="About Dungeon Calendar" detail="Version 1.0.18" onPress={() => navigate("about")} />
      </Card>
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}><Text style={styles.logoutText}>Log Out</Text></TouchableOpacity>
      <TouchableOpacity style={styles.deleteAccountButton} onPress={openDeleteAccount}><Text style={styles.deleteAccountText}>Delete Account</Text></TouchableOpacity>
    </Screen>
  );
}

function ProfileScreen({ navigate, openSettings, user }) {
  const profile = getFirebaseUserProfile(user);
  return (
    <Screen>
      <Header title="Profile" subtitle="Firebase Account" onSettings={openSettings} />
      <Card>
        {profile.avatar ? (
          <Image source={{ uri: profile.avatar }} style={styles.profileLogo} resizeMode="cover" />
        ) : (
          <Image source={require("./assets/dungeon-calendar-logo.png")} style={styles.profileLogo} resizeMode="contain" />
        )}
        <SettingsRow label="Display Name" detail={profile.displayName} onPress={() => navigate("profileEdit")} />
        <SettingsRow label="Email" detail={profile.email} onPress={() => navigate("profileEdit")} />
        <SettingsRow label="Account ID" detail={user?.uid || "Signed in with Firebase"} onPress={() => navigate("profileEdit")} />
      </Card>
    </Screen>
  );
}

function CampaignSettings({ navigate, openSettings, activeCampaign, isDungeonMaster }) {
  return (
    <Screen>
      <Header title="Campaign Settings" subtitle={activeCampaign?.name || "No campaign selected"} onSettings={openSettings} />
      <Card>
        <SettingsRow label="Campaign" detail={activeCampaign?.name || "None"} onPress={() => navigate("campaigns")} />
        <SettingsRow label="Default Session Duration" detail={`${activeCampaign?.sessionDuration || 4} hours`} onPress={() => navigate("campaignEditor")} />
        <SettingsRow label="Default Location" detail={activeCampaign?.defaultLocation || "Not set"} onPress={() => navigate("campaignEditor")} />
        <SettingsRow label="Proposed Dates" detail={`${proposedDatesForCampaign(activeCampaign).length} date(s)`} onPress={() => navigate("calendar")} />
        <SettingsRow label="Token Images" detail="Guildmaster campaign/player tokens" onPress={() => navigate("tokens")} />
        <SettingsRow label="Calendar Links" detail="Google Calendar / Outlook export" onPress={() => navigate("session")} />
        <SettingsRow label="Campaign Role" detail={isDungeonMaster ? "Dungeon Master" : "Player"} onPress={() => navigate("campaignDetail")} />
      </Card>
    </Screen>
  );
}
function Notifications({ navigate, openSettings, user, userProfile }) {
  const notificationSettings = userProfile?.notificationSettings || {};
  const toggleSetting = async (key) => {
    const current = notificationSettings[key] !== false;
    await saveUserSettings(user, {
      notificationSettings: {
        ...notificationSettings,
        [key]: !current,
      },
    });
  };
  const row = (label, key, detail) => (
    <SettingsRow
      label={label}
      detail={`${notificationSettings[key] !== false ? "On" : "Off"} · ${detail}`}
      onPress={() => toggleSetting(key)}
    />
  );
  return (
    <Screen>
      <Header title="Notifications" subtitle="Reminder settings synced to Firebase" onSettings={openSettings} />
      <Card>
        {row("Enable Notifications", "enabled", "Master notification switch")}
        {row("Session Reminders", "sessionReminders", "Before chosen session dates")}
        {row("Player Availability Changes", "availabilityChanges", "When players update responses")}
        {row("Proposed Date Updates", "proposedDateUpdates", "When DMs add or remove dates")}
        <SettingsRow label="Open Plan Settings" detail="Notification features can be tied to plan level" onPress={() => navigate("plan")} />
      </Card>
    </Screen>
  );
}

function PlanSettings({ openSettings, user, userProfile, plan, billingInterval }) {
  const [selectedPlan, setSelectedPlan] = useState("");
  const [selectedInterval, setSelectedInterval] = useState(normalizeBillingInterval(billingInterval));
  const activePlan = readProfilePlan(userProfile || {}, plan || "free");
  const activeInterval = normalizeBillingInterval(billingInterval || userProfile?.billingInterval || "monthly");

  const startCheckout = async (planId) => {
    const safePlan = normalizePlan(planId);
    if (safePlan === activePlan) return;
    if (safePlan === "free") {
      await setDoc(doc(db, "users", user.uid), { plan: "free", billingInterval: "monthly", updatedAt: new Date().toISOString(), updatedAtServer: serverTimestamp() }, { merge: true });
      Alert.alert("Plan Updated", "Your account was moved to the Free plan.");
      return;
    }
    setSelectedPlan(safePlan);
  };

  const continueToStripe = async () => {
    const safePlan = normalizePlan(selectedPlan);
    const safeInterval = normalizeBillingInterval(selectedInterval);
    const baseUrl = stripePaymentLinks[safePlan]?.[safeInterval];
    if (!baseUrl) {
      Alert.alert("Stripe", "No Stripe payment link is configured for that plan and billing cycle.");
      return;
    }
    await setDoc(doc(db, "users", user.uid), {
      pendingStripePlan: safePlan,
      pendingStripeBillingInterval: safeInterval,
      pendingStripeEmail: user?.email || "",
      pendingStripeStartedAt: new Date().toISOString(),
      updatedAtServer: serverTimestamp(),
    }, { merge: true });
    const url = `${baseUrl}?prefilled_email=${encodeURIComponent(user?.email || "")}&client_reference_id=${encodeURIComponent(user?.uid || "")}&stripe_plan=${encodeURIComponent(safePlan)}&stripe_billing=${encodeURIComponent(safeInterval)}`;
    Linking.openURL(url).catch(() => Alert.alert("Stripe", "Could not open Stripe checkout."));
  };

  return (
    <Screen>
      <Header title="Plan Options" subtitle="Same plans and Stripe links as the main web app" onSettings={openSettings} />
      <Card>
        <Text style={styles.sectionTitle}>Current Plan</Text>
        <Text style={styles.planTitle}>{planLimits[activePlan].name}</Text>
        <Text style={styles.helperText}>{activePlan === "free" ? "$0" : `${formatPlanPrice(activePlan, activeInterval)} · billed ${activeInterval}`}</Text>
        <Text style={styles.notesText}>Subscription status is synced to your Firebase user account. Paid plans unlock the same features as the main web app.</Text>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Stripe subscription sync is automatic</Text>
        <Text style={styles.notesText}>Choose a paid plan to open Stripe Checkout. After checkout, return to Dungeon Calendar and the web app/mobile app use the same Firebase account plan.</Text>
      </Card>

      {planCards.map((item) => {
        const isActive = activePlan === item.id;
        return (
          <Card key={item.id} style={isActive ? styles.activePlanCard : null}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.campaignTitle}>{item.name}</Text>
                <Text style={styles.sessionText}>{item.description}</Text>
              </View>
              <Text style={styles.planPrice}>{item.id === "free" ? "$0" : formatPlanPrice(item.id, "monthly")}</Text>
            </View>
            {item.id !== "free" ? <Text style={styles.helperText}>{yearlySavingsLabel(item.id)}</Text> : null}
            {item.features.map((feature) => <View key={feature} style={styles.planFeatureRow}><Text style={styles.planCheck}>•</Text><Text style={styles.planFeatureText}>{feature}</Text></View>)}
            <TouchableOpacity style={isActive ? styles.activePlanButton : styles.outlineWideButton} onPress={() => startCheckout(item.id)} disabled={isActive}>
              <Text style={isActive ? styles.activePlanText : styles.outlineButtonText}>{getPlanActionLabel(activePlan, item.id)}</Text>
            </TouchableOpacity>
          </Card>
        );
      })}

      {selectedPlan ? (
        <Card>
          <Text style={styles.sectionTitle}>Checkout</Text>
          <Text style={styles.helperText}>{planLimits[selectedPlan].name} Plan — {formatPlanPrice(selectedPlan, selectedInterval)}</Text>
          <View style={styles.billingToggleRow}>
            <TouchableOpacity style={[styles.billingToggle, selectedInterval === "monthly" ? styles.billingToggleActive : null]} onPress={() => setSelectedInterval("monthly")}>
              <Text style={styles.billingToggleText}>Monthly — {formatPlanPrice(selectedPlan, "monthly")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.billingToggle, selectedInterval === "yearly" ? styles.billingToggleActive : null]} onPress={() => setSelectedInterval("yearly")}>
              <Text style={styles.billingToggleText}>Yearly — {formatPlanPrice(selectedPlan, "yearly")}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.notesText}>Payment details are collected by Stripe. Dungeon Calendar never stores card numbers.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={continueToStripe}><Text style={styles.primaryButtonText}>Continue to Stripe - {formatPlanPrice(selectedPlan, selectedInterval)}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.outlineWideButton} onPress={() => setSelectedPlan("")}><Text style={styles.outlineButtonText}>Cancel</Text></TouchableOpacity>
        </Card>
      ) : null}
    </Screen>
  );
}
function SimpleInfoPage({ title, children, openSettings }) {
  return (
    <Screen>
      <Header title={title} onSettings={openSettings} />
      <Card>
        {children}
      </Card>
    </Screen>
  );
}

function PrivacyPolicyMobile({ openSettings }) {
  return (
    <SimpleInfoPage title="Privacy Policy" openSettings={openSettings}>
      <Text style={styles.sectionTitle}>Privacy Policy</Text>
      <Text style={styles.helperText}>Last Updated: June 2026</Text>
      <Text style={styles.notesText}>Dungeon Calendar collects account, campaign, scheduling, and subscription information necessary to provide the service.</Text>
      <Text style={styles.sectionTitle}>Information We Collect</Text>
      <Text style={styles.notesText}>We may collect your name, username, email address, optional phone number, profile settings, campaign membership, character names, availability responses, campaign settings, and subscription status.</Text>
      <Text style={styles.sectionTitle}>How We Use Information</Text>
      <Text style={styles.notesText}>We use this information to operate Dungeon Calendar, manage campaigns, schedule sessions, save user settings, process subscription access, provide support, and improve reliability.</Text>
      <Text style={styles.sectionTitle}>Firebase and Stripe</Text>
      <Text style={styles.notesText}>Dungeon Calendar uses Firebase for authentication and cloud storage. Stripe processes subscription payments. Dungeon Calendar does not store full credit card numbers.</Text>
      <Text style={styles.sectionTitle}>Data Sharing</Text>
      <Text style={styles.notesText}>We do not sell personal information. Data may be shared with service providers necessary to operate the app, including Firebase and Stripe.</Text>
      <Text style={styles.sectionTitle}>Account Updates and Deletion</Text>
      <Text style={styles.notesText}>You may update profile information in the app. For account deletion or privacy support, contact support@dungeoncalendar.com.</Text>
      <Text style={styles.sectionTitle}>Children's Privacy</Text>
      <Text style={styles.notesText}>Dungeon Calendar is not directed toward children under 13 without appropriate parental or guardian involvement.</Text>
      <Text style={styles.sectionTitle}>Contact</Text>
      <Text style={styles.notesText}>Email: support@dungeoncalendar.com</Text>
    </SimpleInfoPage>
  );
}

function TermsOfServiceMobile({ openSettings }) {
  return (
    <SimpleInfoPage title="Terms of Service" openSettings={openSettings}>
      <Text style={styles.sectionTitle}>Terms of Service</Text>
      <Text style={styles.helperText}>Last Updated: June 2026</Text>
      <Text style={styles.notesText}>By using Dungeon Calendar, you agree to use the service lawfully and responsibly.</Text>
      <Text style={styles.sectionTitle}>Use of Dungeon Calendar</Text>
      <Text style={styles.notesText}>Dungeon Calendar is a scheduling and campaign management tool for tabletop role-playing games. You agree to use the service only for lawful and appropriate purposes.</Text>
      <Text style={styles.sectionTitle}>Accounts</Text>
      <Text style={styles.notesText}>You are responsible for maintaining your account security and for activity under your account.</Text>
      <Text style={styles.sectionTitle}>Campaign Content</Text>
      <Text style={styles.notesText}>You are responsible for campaign names, character names, invites, availability data, and other content you create or share.</Text>
      <Text style={styles.sectionTitle}>Subscriptions and Billing</Text>
      <Text style={styles.notesText}>Paid plans are processed through Stripe. Subscription features, prices, and billing intervals may change over time. Users are responsible for managing their subscriptions according to the applicable Stripe checkout and billing terms.</Text>
      <Text style={styles.sectionTitle}>Availability of Service</Text>
      <Text style={styles.notesText}>We try to keep Dungeon Calendar available, but we do not guarantee uninterrupted access. Features may change as the app improves.</Text>
      <Text style={styles.sectionTitle}>Contact</Text>
      <Text style={styles.notesText}>For support or terms questions, contact support@dungeoncalendar.com.</Text>
    </SimpleInfoPage>
  );
}

const aboutFeatureCards = [
  { title: "Campaign Management", text: "Create campaigns, invite players, assign Dungeon Masters, and keep every adventure organized in one place." },
  { title: "Session Scheduling", text: "Use a shared calendar to find dates that work for the whole party without endless group chats." },
  { title: "Availability Tracking", text: "Players can mark available or unavailable dates so Dungeon Masters can choose the best session time." },
  { title: "Player Invites", text: "Send campaign invite links by email or copy a ready-to-share message for your group chat." },
  { title: "Cross-Device Access", text: "Use Dungeon Calendar from desktop, tablet, or phone with the same Firebase account and profile." },
  { title: "Paid DM Tools", text: "Adventurer and Guildmaster plans unlock more campaign creation, calendar exports, tracking tools, and premium features." },
];

const aboutTrustItems = ["Campaign Scheduling", "Availability Tracking", "Email Invites", "Cross-Device Access", "Firebase Security", "Stripe Billing"];
const aboutAudienceItems = ["Dungeon Masters", "D&D players", "Pathfinder groups", "Online campaigns", "In-person tables", "Tabletop RPG communities"];

function AboutPage({ openSettings }) {
  const openDungeonCalendar = () => Linking.openURL("https://dungeoncalendar.com");

  return (
    <Screen>
      <Header title="About" subtitle="Dungeon Calendar" onSettings={openSettings} />

      <Card style={styles.aboutHeroCard}>
        <Image source={require("./assets/dungeon-calendar-logo.png")} style={styles.aboutLogo} resizeMode="contain" />
        <Text style={styles.aboutTitle}>Dungeon Calendar</Text>
        <Text style={styles.aboutKicker}>D&D Campaign Scheduling & Session Planning</Text>
        <Text style={styles.sessionText}>Version 1.0.16</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={openDungeonCalendar}>
          <Text style={styles.primaryButtonText}>Open DungeonCalendar.com</Text>
        </TouchableOpacity>
      </Card>

      <Card>
        <Text style={styles.aboutEyebrow}>About Dungeon Calendar</Text>
        <Text style={styles.aboutHeadline}>Schedule tabletop RPG sessions without endless group chats.</Text>
        <Text style={styles.aboutBody}>
          Dungeon Calendar is a campaign scheduling and player management app built for Dungeons & Dragons, Pathfinder, and other tabletop RPG groups. Dungeon Masters can manage campaigns, collect player availability, invite party members, and choose final session dates from one organized calendar.
        </Text>
      </Card>

      <Card style={styles.aboutAmberCard}>
        <Text style={styles.aboutAmberHeadline}>Built for parties that actually want to play.</Text>
        <Text style={styles.aboutBody}>Use Dungeon Calendar to reduce scheduling friction, organize player responses, and keep your next adventure moving.</Text>
        <View style={styles.aboutMiniCard}>
          <Text style={styles.aboutMiniTitle}>D&D scheduling</Text>
          <Text style={styles.aboutMiniText}>Coordinate sessions with a visual campaign calendar.</Text>
        </View>
        <View style={styles.aboutMiniCard}>
          <Text style={styles.aboutMiniTitle}>Dungeon Master tools</Text>
          <Text style={styles.aboutMiniText}>Manage campaigns, invites, players, and final dates.</Text>
        </View>
        <View style={styles.aboutMiniCard}>
          <Text style={styles.aboutMiniTitle}>Player availability</Text>
          <Text style={styles.aboutMiniText}>Let everyone mark available and unavailable dates.</Text>
        </View>
      </Card>

      <Card>
        <Text style={styles.aboutEyebrow}>Trusted Dungeon Master Tools</Text>
        <Text style={styles.sectionTitle}>A shared scheduling hub for every adventure.</Text>
        <View style={styles.aboutPillGrid}>
          {aboutTrustItems.map((item) => (
            <View key={item} style={styles.aboutPill}>
              <Text style={styles.aboutPillText}>{item}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <Text style={styles.aboutEyebrow}>Features</Text>
        <Text style={styles.sectionTitle}>Everything your campaign needs to plan the next session.</Text>
        {aboutFeatureCards.map((feature) => (
          <View key={feature.title} style={styles.aboutFeatureCard}>
            <Text style={styles.aboutFeatureTitle}>{feature.title}</Text>
            <Text style={styles.aboutFeatureText}>{feature.text}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={styles.aboutEyebrow}>Who it is for</Text>
        <View style={styles.aboutPillGrid}>
          {aboutAudienceItems.map((item) => (
            <View key={item} style={styles.aboutPill}>
              <Text style={styles.aboutPillText}>{item}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Card style={styles.aboutCtaCard}>
        <Text style={styles.aboutHeadline}>Ready to start your next adventure?</Text>
        <Text style={styles.aboutBody}>Create a free account, invite your party, and find the best date for your next campaign session.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={openDungeonCalendar}>
          <Text style={styles.primaryButtonText}>Create Your Free Account</Text>
        </TouchableOpacity>
        <Text style={styles.aboutFooter}>© 2026 Dungeon Calendar. All rights reserved.</Text>
      </Card>
    </Screen>
  );
}


function EditableField({ label, value, editable = true, onChangeText }) {
  const [text, setText] = useState(value || "");
  useEffect(() => setText(value || ""), [value]);
  const handleChange = (next) => { setText(next); if (onChangeText) onChangeText(next); };
  return (
    <View style={styles.editableField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput value={text} onChangeText={handleChange} editable={editable} selectTextOnFocus={editable} style={[styles.fieldInput, !editable && styles.fieldInputDisabled]} placeholderTextColor="#6b7280" />
    </View>
  );
}

function ProposeDateScreen({ openSettings, activeCampaign, isDungeonMaster, navigate }) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateText, setDateText] = useState(today);
  const addDate = async () => {
    if (!activeCampaign || !isDungeonMaster) return;
    const key = String(dateText || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      Alert.alert("Date format", "Use YYYY-MM-DD, for example 2026-07-04.");
      return;
    }
    await saveCampaign({ ...activeCampaign, manuallySelectedDates: Array.from(new Set([...(activeCampaign.manuallySelectedDates || []), key])) });
    navigate("calendar");
  };
  return (
    <Screen>
      <Header title="Propose Dates" subtitle={activeCampaign?.name || "DM date selection"} onSettings={openSettings} />
      <Card>
        <Text style={styles.sectionTitle}>Add Proposed Date</Text>
        <Text style={styles.helperText}>Dates save to the same Firebase campaign document used by the web app.</Text>
        <EditableField label="Date (YYYY-MM-DD)" value={dateText} onChangeText={setDateText} />
        <TouchableOpacity style={styles.primaryButton} onPress={addDate}><Text style={styles.primaryButtonText}>Save Proposed Date</Text></TouchableOpacity>
      </Card>
    </Screen>
  );
}
function CampaignEditor({ openSettings, activeCampaign, user, navigate }) {
  const [name, setName] = useState(activeCampaign?.name || "");
  const [level, setLevel] = useState(activeCampaign?.level || "");
  const [location, setLocation] = useState(activeCampaign?.defaultLocation || "");
  const [duration, setDuration] = useState(String(activeCampaign?.sessionDuration || 4));
  const save = async () => {
    const campaign = activeCampaign || normalizeCampaign({ ownerId: user?.uid, dungeonMasterIds: [user?.uid].filter(Boolean), memberIds: [user?.uid].filter(Boolean) });
    await saveCampaign({ ...campaign, name: name || "Untitled Campaign", level, defaultLocation: location, sessionDuration: Number(duration || 4) });
    navigate("campaigns");
  };
  return (
    <Screen>
      <Header title={activeCampaign ? "Edit Campaign" : "Add Campaign"} subtitle={activeCampaign?.name || "New Firebase campaign"} onSettings={openSettings} />
      <Card>
        <EditableField label="Campaign Name" value={name} onChangeText={setName} />
        <EditableField label="Campaign Level" value={level} onChangeText={setLevel} />
        <EditableField label="Default Location" value={location} onChangeText={setLocation} />
        <EditableField label="Default Duration" value={duration} onChangeText={setDuration} />
        <TouchableOpacity style={styles.primaryButton} onPress={save}><Text style={styles.primaryButtonText}>Save Campaign</Text></TouchableOpacity>
      </Card>
    </Screen>
  );
}
function PlayerEditor({ openSettings, activeCampaign, navigate }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Player");
  const save = async () => {
    if (!activeCampaign) return;
    const nextPlayer = campaignPlayerRecord({ name, email, role, invitePending: true }, activeCampaign.id);
    await saveCampaign({
      ...activeCampaign,
      invitedPlayers: [...(activeCampaign.invitedPlayers || []), nextPlayer],
      invitedEmails: Array.from(new Set([...(activeCampaign.invitedEmails || []), normalizeEmail(email)].filter(Boolean))),
    });
    navigate("players");
  };
  return (
    <Screen>
      <Header title="Player Editor" subtitle="Add campaign invite/player" onSettings={openSettings} />
      <Card>
        <EditableField label="Player Name" value={name} onChangeText={setName} />
        <EditableField label="Email" value={email} onChangeText={setEmail} />
        <EditableField label="Role" value={role} onChangeText={setRole} />
        <TouchableOpacity style={styles.primaryButton} onPress={save}><Text style={styles.primaryButtonText}>Save Player</Text></TouchableOpacity>
      </Card>
    </Screen>
  );
}
function TokenSettings({ openSettings, activeCampaign, activePlayers = [], isDungeonMaster, plan, navigate }) {
  const [campaignTokenUrl, setCampaignTokenUrl] = useState(activeCampaign?.tokenUrl || activeCampaign?.campaignTokenUrl || "");
  const [playerTokenUrls, setPlayerTokenUrls] = useState({});
  const [uploadingKey, setUploadingKey] = useState("");
  useEffect(() => {
    const initial = {};
    (activeCampaign?.invitedPlayers || []).forEach((p) => {
      const key = p.id || p.uid || normalizeEmail(p.email);
      if (key) initial[key] = p.tokenUrl || "";
    });
    setPlayerTokenUrls(initial);
    setCampaignTokenUrl(activeCampaign?.tokenUrl || activeCampaign?.campaignTokenUrl || "");
  }, [activeCampaign?.id]);
  const uploadTokenImage = async (targetKey, setter) => {
    if (!activeCampaign || !isDungeonMaster) return;
    if (!hasPlanFeature(plan, "tokenUploads")) {
      navigate("plan");
      return;
    }
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Photo Permission Needed", "Allow photo access to upload token images.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setUploadingKey(targetKey);
      const uri = result.assets[0].uri;
      const response = await fetch(uri);
      const blob = await response.blob();
      const ext = (uri.split(".").pop() || "jpg").split("?")[0].toLowerCase();
      const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
      const imageRef = ref(storage, `campaignTokens/${activeCampaign.id}/${targetKey}-${Date.now()}.${safeExt}`);
      await uploadBytes(imageRef, blob, { contentType: `image/${safeExt === "jpg" ? "jpeg" : safeExt}` });
      const url = await getDownloadURL(imageRef);
      setter(url);
    } catch (error) {
      Alert.alert("Upload Failed", error?.message || "The token image could not be uploaded.");
    } finally {
      setUploadingKey("");
    }
  };
  const saveTokens = async () => {
    if (!activeCampaign || !isDungeonMaster) return;
    if (!hasPlanFeature(plan, "tokenUploads")) {
      navigate("plan");
      return;
    }
    const invitedPlayers = (activeCampaign.invitedPlayers || []).map((p) => {
      const key = p.id || p.uid || normalizeEmail(p.email);
      return { ...p, tokenUrl: playerTokenUrls[key] || p.tokenUrl || "" };
    });
    await saveCampaign({ ...activeCampaign, tokenUrl: campaignTokenUrl, campaignTokenUrl, invitedPlayers });
    Alert.alert("Tokens Saved", "Uploaded token images and token links are synced to Firebase.");
  };
  return (
    <Screen>
      <Header title="Token Images" subtitle="Guildmaster campaign/player tokens" onSettings={openSettings} />
      {!hasPlanFeature(plan, "tokenUploads") ? (
        <Card>
          <Text style={styles.sectionTitle}>Guildmaster Feature</Text>
          <Text style={styles.notesText}>Custom player token image uploads are included with the Guildmaster plan.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => navigate("plan")}><Text style={styles.primaryButtonText}>View Plans</Text></TouchableOpacity>
        </Card>
      ) : (
        <Card>
          <Text style={styles.sectionTitle}>Campaign Token</Text>
          {campaignTokenUrl ? <Image source={{ uri: campaignTokenUrl }} style={styles.tokenPreview} /> : null}
          <TouchableOpacity style={styles.primaryButton} onPress={() => uploadTokenImage("campaign", setCampaignTokenUrl)} disabled={uploadingKey === "campaign"}>
            <Text style={styles.primaryButtonText}>{uploadingKey === "campaign" ? "Uploading..." : "Upload Campaign Token"}</Text>
          </TouchableOpacity>
          <EditableField label="Campaign Token Image URL" value={campaignTokenUrl} onChangeText={setCampaignTokenUrl} />
          <Text style={styles.helperText}>Upload an image from your device or paste a URL. The saved image URL is stored on the same Firebase campaign used by the web app.</Text>
          <Text style={styles.sectionTitle}>Player Tokens</Text>
          {activePlayers.map((player) => {
            const key = player.id || normalizeEmail(player.email);
            const currentUrl = playerTokenUrls[key] || player.tokenUrl || "";
            return (
              <View key={key} style={styles.tokenRow}>
                <Text style={styles.cardTitle}>{player.name || player.email}</Text>
                {currentUrl ? <Image source={{ uri: currentUrl }} style={styles.tokenPreview} /> : null}
                <TouchableOpacity style={styles.outlineWideButton} onPress={() => uploadTokenImage(`player-${key}`, (url) => setPlayerTokenUrls((current) => ({ ...current, [key]: url })))} disabled={uploadingKey === `player-${key}`}>
                  <Text style={styles.outlineButtonText}>{uploadingKey === `player-${key}` ? "Uploading..." : "Upload Player Token"}</Text>
                </TouchableOpacity>
                <EditableField label={`${player.name || player.email} Token URL`} value={currentUrl} onChangeText={(value) => setPlayerTokenUrls((current) => ({ ...current, [key]: value }))} />
              </View>
            );
          })}
          <TouchableOpacity style={styles.primaryButton} onPress={saveTokens}><Text style={styles.primaryButtonText}>Save Tokens</Text></TouchableOpacity>
        </Card>
      )}
    </Screen>
  );
}
function AvailabilityScreen({ openSettings, user, activeCampaign, proposedDates = [] }) {
  const toggle = async (dateKey, status) => {
    if (!activeCampaign || !user?.uid) return;
    const available = new Set(activeCampaign.availability?.[dateKey] || []);
    const unavailable = new Set(activeCampaign.unavailable?.[dateKey] || []);
    if (status === "available") {
      if (available.has(user.uid)) available.delete(user.uid);
      else { available.add(user.uid); unavailable.delete(user.uid); }
    }
    if (status === "unavailable") {
      if (unavailable.has(user.uid)) unavailable.delete(user.uid);
      else { unavailable.add(user.uid); available.delete(user.uid); }
    }
    await saveCampaign({ ...activeCampaign, availability: { ...(activeCampaign.availability || {}), [dateKey]: Array.from(available) }, unavailable: { ...(activeCampaign.unavailable || {}), [dateKey]: Array.from(unavailable) } });
  };
  return (
    <Screen>
      <Header title="My Availability" subtitle={activeCampaign?.name || "Respond to proposed dates"} onSettings={openSettings} />
      <Card>
        {proposedDates.length ? proposedDates.map((date) => (
          <View key={date.key} style={styles.availabilityRow}>
            <DateBadge month={date.month} day={date.day} weekday={date.weekday} />
            <View style={styles.eventInfo}>
              <Text style={styles.sessionTitle}>{date.full || date.label}</Text>
              <View style={styles.responseButtons}>
                <TouchableOpacity style={styles.voteAvailable} onPress={() => toggle(date.key, "available")}><Text style={styles.voteButtonText}>Available</Text></TouchableOpacity>
                <TouchableOpacity style={styles.voteUnavailable} onPress={() => toggle(date.key, "unavailable")}><Text style={styles.voteButtonText}>Unavailable</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        )) : <Text style={styles.helperText}>No dates have been proposed yet.</Text>}
      </Card>
    </Screen>
  );
}
function ProfileEditScreen({ openSettings, user }) {
  const profile = getFirebaseUserProfile(user);
  return (
    <Screen>
      <Header title="Edit Profile" subtitle="Firebase account information" onSettings={openSettings} />
      <Card>
        {profile.avatar ? (
          <Image source={{ uri: profile.avatar }} style={styles.profileLogo} resizeMode="cover" />
        ) : (
          <Image source={require("./assets/dungeon-calendar-logo.png")} style={styles.profileLogo} resizeMode="contain" />
        )}
        <EditableField label="Display Name" value={profile.displayName} />
        <EditableField label="Email" value={profile.email} editable={false} />
        <EditableField label="Firebase UID" value={user?.uid || ""} editable={false} />
        <Text style={styles.helperText}>Profile edits should be saved to the signed-in Firebase user record. Email and UID are shown from Firebase Auth and are not dummy data.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => Alert.alert("Profile", "Your profile is linked to your Firebase account.")}>
          <Text style={styles.primaryButtonText}>Save Profile</Text>
        </TouchableOpacity>
      </Card>
    </Screen>
  );
}

function SettingsRow({ label, detail, onPress }) {
  return (
    <TouchableOpacity style={styles.settingsRow} activeOpacity={0.8} onPress={onPress}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={styles.menuItemText}>{label}</Text>
        <Text style={styles.resultMeta}>{detail}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function SettingsModal({ visible, onClose, navigate, openDeleteAccount, handleLogout, proposedDates = [] }) {
  const settings = [
    ["User Settings", "settings"],
    ["Campaign Settings", "campaignSettings"],
    ["Plan Settings", "plan"],
    ["Notifications", "notifications"],
    ["Privacy Policy", "privacy"],
    ["Terms of Service", "terms"],
    ["About Dungeon Calendar", "about"],
  ];
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalBackdrop}>
        <View style={styles.drawer}>
          <View style={styles.drawerHeader}>
            <Text style={styles.drawerTitle}>Settings</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.closeText}>×</Text></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.drawerScrollContent}>

          <Card>
            <Text style={styles.menuGroup}>Recent Results</Text>
            {proposedDates.map((d) => (
              <View key={d.key} style={styles.resultRow}>
                <Icon>▥</Icon>
                <View style={styles.resultInfo}>
                  <Text style={styles.resultName}>{d.label}</Text>
                  <Text style={styles.resultMeta}>{d.available} available · {d.unavailable} unavailable</Text>
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.menuItem} onPress={() => { onClose(); navigate("results"); }}>
              <Text style={styles.menuItemText}>View All Results</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          </Card>

          <Card>
            <Text style={styles.menuGroup}>Settings</Text>
            {settings.map(([label, route]) => (
              <TouchableOpacity key={label} style={styles.menuItem} onPress={() => { onClose(); navigate(route); }}>
                <Text style={styles.menuItemText}>{label}</Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.menuItem} onPress={() => { onClose(); handleLogout(); }}>
              <Text style={[styles.menuItemText, { color: COLORS.red }]}>Log Out</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={() => { onClose(); openDeleteAccount(); }}>
              <Text style={[styles.menuItemText, { color: "#f87171" }]}>Delete Account</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          </Card>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DeleteAccountModal({ visible, onClose, onDeleteAccount }) {
  const [confirmText, setConfirmText] = useState("");
  const canDelete = confirmText === "DELETE";

  const closeAndReset = () => {
    setConfirmText("");
    onClose();
  };

  const confirmDelete = () => {
    if (!canDelete) return;
    onDeleteAccount?.();
    closeAndReset();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.confirmBackdrop}>
        <View style={styles.confirmBox}>
          <Text style={styles.confirmIcon}>⚠</Text>
          <Text style={styles.confirmTitle}>Delete Account?</Text>
          <Text style={styles.confirmText}>
            This permanently deletes your Dungeon Calendar account, profile, saved availability, and personal settings.
          </Text>
          <Text style={styles.confirmText}>
            Campaigns you own may need to be transferred or deleted first. This action cannot be undone.
          </Text>

          <Text style={styles.confirmLabel}>Type DELETE to continue</Text>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            autoCapitalize="characters"
            placeholder="DELETE"
            placeholderTextColor="#6b7280"
            style={styles.deleteInput}
          />

          <TouchableOpacity
            style={[styles.deleteConfirmButton, !canDelete ? styles.disabledButton : null]}
            disabled={!canDelete}
            onPress={confirmDelete}
          >
            <Text style={styles.deleteConfirmText}>Delete Account</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelDeleteButton} onPress={closeAndReset}>
            <Text style={styles.cancelDeleteText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function SyncBanner({ syncStatus, onReconnect }) {
  if (!syncStatus || syncStatus === "live" || syncStatus === "signed-out") return null;
  const label = syncStatus === "cache" ? "Offline/cache mode - reconnecting to Firebase..." : syncStatus === "error" ? "Firebase sync error. Tap to reconnect." : "Connecting to Firebase live sync...";
  return (
    <TouchableOpacity style={styles.syncBanner} onPress={onReconnect} activeOpacity={0.85}>
      <Text style={styles.syncBannerText}>{label}</Text>
    </TouchableOpacity>
  );
}

function BottomNav({ route, navigate, openSettings }) {
  const items = [
    ["dashboard", "⌂", "Dashboard"],
    ["calendar", "▣", "Calendar"],
    ["campaigns", "◈", "Campaigns"],
    ["players", "♟", "Players"],
    ["more", "•••", "More"],
  ];

  return (
    <View style={styles.bottomNav}>
      {items.map(([key, icon, label]) => {
        const active = route === key;
        const onPress = key === "more" ? openSettings : () => navigate(key);
        return (
          <TouchableOpacity key={key} style={styles.navItem} onPress={onPress} activeOpacity={0.8}>
            <Text style={[styles.navIcon, active && styles.navActive]}>{icon}</Text>
            <Text style={[styles.navLabel, active && styles.navActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function DungeonCalendarMobileApp() {
  const [route, setRoute] = useState("dashboard");
  const [user, setUser] = useState(auth.currentUser);
  const [authError, setAuthError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [syncStatus, setSyncStatus] = useState("connecting");
  const [userProfile, setUserProfile] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setCampaigns([]);
      setSelectedCampaignId("");
      setUserProfile(null);
      setSyncStatus("signed-out");
      return undefined;
    }
    let unsubscribeSync = () => {};
    setSyncStatus("connecting");
    enableNetwork(db).catch((error) => {
      console.warn("Could not force Firestore network on:", error);
    });
    const unsubscribeProfile = onSnapshot(doc(db, "users", user.uid), { includeMetadataChanges: true }, (snap) => {
      setUserProfile(snap.exists() ? snap.data() : null);
    }, (error) => {
      console.warn("Mobile profile sync failed:", error);
      setUserProfile(null);
    });
    unsubscribeSync = onSnapshotsInSync(db, () => {
      setSyncStatus("live");
    });
    const unsubscribe = onSnapshot(collection(db, "campaigns"), { includeMetadataChanges: true }, (snapshot) => {
      setSyncStatus(snapshot.metadata.fromCache ? "cache" : "live");
      const visibleCampaigns = snapshot.docs
        .map((item) => normalizeCampaign({ id: item.id, ...item.data() }))
        .filter((campaign) => visibleToUser(campaign, user))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      setCampaigns(visibleCampaigns);
      setSelectedCampaignId((current) => current && visibleCampaigns.some((c) => c.id === current) ? current : (visibleCampaigns[0]?.id || ""));
    }, (error) => {
      console.warn("Mobile campaign sync failed:", error);
      setSyncStatus("error");
      setAuthError(error?.message || "Could not load campaigns from Firebase.");
    });
    return () => {
      unsubscribe();
      unsubscribeProfile();
      unsubscribeSync();
    };
  }, [user]);

  const navigate = (next) => {
    if (next === "more") {
      setSettingsOpen(true);
      return;
    }
    setRoute(next);
  };

  const refreshFirebaseNetwork = async () => {
    setSyncStatus("connecting");
    await enableNetwork(db).catch((error) => {
      setSyncStatus("error");
      setAuthError(error?.message || "Could not reconnect to Firebase.");
    });
  };

  const handleGoogleLogin = async () => {
    setAuthError("");
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const signInResult = await GoogleSignin.signIn();
      const idToken = signInResult?.data?.idToken || signInResult?.idToken;
      if (!idToken) throw new Error("Google Sign-In did not return an ID token.");
      const result = await signInToFirebaseWithGoogleIdToken(idToken);
      setUser(result.user);
      setRoute("dashboard");
    } catch (error) {
      if (error?.code === statusCodes.SIGN_IN_CANCELLED) {
        setAuthError("Google sign-in was cancelled.");
      } else {
        setAuthError(error?.message || "Google sign-in failed.");
      }
    }
  };

  const handleEmailLogin = () => {
    setAuthError("Email login screen should connect to the same Firebase Email/Password provider as the main app.");
  };

  const handleLogout = () => {
    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut();
            await GoogleSignin.signOut().catch(() => {});
          } finally {
            setSettingsOpen(false);
            setUser(null);
            setRoute("dashboard");
          }
        },
      },
    ]);
  };

  const activeCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) || campaigns[0] || null;
  const activePlayers = campaignPlayers(activeCampaign, user);
  const proposedDates = proposedDatesForCampaign(activeCampaign);
  const isDungeonMaster = userIsDungeonMaster(user, activeCampaign);
  const plan = readProfilePlan(userProfile || {}, "free");
  const billingInterval = normalizeBillingInterval(userProfile?.billingInterval || "monthly");

  const props = {
    navigate,
    user,
    campaigns,
    activeCampaign,
    activePlayers,
    proposedDates,
    isDungeonMaster,
    selectedCampaignId,
    setSelectedCampaignId,
    openSettings: () => setSettingsOpen(true),
    openDeleteAccount: () => setDeleteAccountOpen(true),
    handleLogout,
    syncStatus,
    refreshFirebaseNetwork,
    userProfile,
    plan,
    billingInterval,
  };

  const screen = useMemo(() => {
    switch (route) {
      case "calendar":
        return <CalendarScreen {...props} />;
      case "campaigns":
        return <Campaigns {...props} />;
      case "campaignDetail":
        return <CampaignDetail {...props} />;
      case "campaignEditor":
        return <CampaignEditor {...props} />;
      case "proposeDate":
        return <ProposeDateScreen {...props} />;
      case "players":
        return <Players {...props} />;
      case "playerEditor":
        return <PlayerEditor {...props} />;
      case "availability":
        return <AvailabilityScreen {...props} />;
      case "tokens":
        return <TokenSettings {...props} />;
      case "results":
        return <Results {...props} />;
      case "settings":
        return <UserSettings {...props} />;
      case "profile":
        return <ProfileScreen {...props} />;
      case "profileEdit":
        return <ProfileEditScreen {...props} />;
      case "campaignSettings":
        return <CampaignSettings {...props} />;
      case "notifications":
        return <Notifications {...props} />;
      case "privacy":
        return <PrivacyPolicyMobile openSettings={props.openSettings} />;
      case "terms":
        return <TermsOfServiceMobile openSettings={props.openSettings} />;
      case "about":
        return <AboutPage {...props} />;
      case "plan":
        return <PlanSettings {...props} />;
      case "session":
        return <SessionDetails {...props} />;
      default:
        return <Dashboard {...props} />;
    }
  }, [route, user, campaigns, selectedCampaignId, userProfile]);

  if (!user) {
    return <LoginScreen onGoogleLogin={handleGoogleLogin} onEmailLogin={handleEmailLogin} authError={authError} />;
  }

  return (
    <View style={styles.app}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      {screen}
      <SyncBanner syncStatus={syncStatus} onReconnect={refreshFirebaseNetwork} />
      <BottomNav route={route} navigate={navigate} openSettings={() => setSettingsOpen(true)} />
      <SettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        navigate={navigate}
        openDeleteAccount={() => setDeleteAccountOpen(true)}
        handleLogout={handleLogout}
        proposedDates={proposedDates}
      />
      <DeleteAccountModal visible={deleteAccountOpen} onClose={() => setDeleteAccountOpen(false)} onDeleteAccount={async () => { await signOut().catch(() => {}); await GoogleSignin.signOut().catch(() => {}); setUser(null); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: COLORS.bg },
  safeArea: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? 48 : 18,
    paddingBottom: 118,
  },
  loginScreen: { flex: 1, backgroundColor: COLORS.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  loginLogo: { width: 190, height: 190, marginBottom: 16 },
  loginTitle: { color: COLORS.gold, fontSize: 34, fontWeight: "900", textAlign: "center" },
  loginSubtitle: { color: COLORS.white, fontSize: 18, fontWeight: "800", marginTop: 8, marginBottom: 28 },
  legalText: { color: COLORS.muted, fontSize: 12, textAlign: "center", marginTop: 20, lineHeight: 18 },
  header: { minHeight: 160, marginBottom: 12 },
  brandRow: { flexDirection: "row", alignItems: "center", paddingRight: 68, marginBottom: 12 },
  logo: { width: 88, height: 88, marginRight: 12 },
  brandCopy: { justifyContent: "center", flexShrink: 1 },
  brandGold: { color: COLORS.gold, fontSize: 27, fontWeight: "900", lineHeight: 30 },
  cogButton: {
    position: "absolute",
    right: 0,
    top: Platform.OS === "android" ? 18 : 8,
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.gold,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,10,10,0.92)",
  },
  cogText: { color: COLORS.gold, fontSize: 26 },
  pageTitle: { color: COLORS.white, fontSize: 26, fontWeight: "900" },
  pageSubtitle: { color: COLORS.gold, fontSize: 18, fontWeight: "900", marginTop: 6 },
  selector: {
    height: 50,
    backgroundColor: COLORS.panel2,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  selectorIcon: { color: COLORS.gold, fontSize: 20, marginRight: 10 },
  selectorText: { color: COLORS.white, fontSize: 15, fontWeight: "800", flex: 1 },
  selectorPlan: { color: COLORS.gold, fontSize: 11, marginRight: 10 },
  selectorChevron: { color: COLORS.red, fontSize: 20 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginBottom: 12 },
  card: {
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  statCard: {
    width: "48%",
    minHeight: 100,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  icon: { fontSize: 22, fontWeight: "900" },
  statLabel: { color: COLORS.muted, fontSize: 12, marginTop: 9 },
  statValue: { color: COLORS.white, fontSize: 21, fontWeight: "900", marginTop: 4 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  inlineTitle: { flexDirection: "row", alignItems: "center" },
  sectionTitle: { color: COLORS.white, fontSize: 18, fontWeight: "900" },
  helperText: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  outlineButton: { borderWidth: 1, borderColor: COLORS.red, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  outlineWideButton: { borderWidth: 1, borderColor: COLORS.red, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  outlineButtonText: { color: "#ff5a52", fontSize: 12, fontWeight: "800" },
  sessionRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  dateBadge: {
    width: 64,
    height: 82,
    borderRadius: 10,
    backgroundColor: "#111111",
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  dateMonth: { color: COLORS.red, fontSize: 12, fontWeight: "900" },
  dateDay: { color: COLORS.white, fontSize: 28, fontWeight: "900", lineHeight: 32 },
  dateWeekday: { color: COLORS.muted, fontSize: 14, fontWeight: "800" },
  sessionArt: { width: 70, height: 82, borderRadius: 10, backgroundColor: "#0f2741", marginRight: 12 },
  sessionInfo: { flex: 1 },
  sessionTitle: { color: COLORS.white, fontSize: 15, fontWeight: "900" },
  sessionText: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  sessionAccent: { color: "#ff6b5f", fontSize: 12, marginTop: 4 },
  chevron: { color: COLORS.white, fontSize: 24 },
  primaryButton: { backgroundColor: COLORS.redDark, borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  primaryButtonSmall: { backgroundColor: COLORS.redDark, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16 },
  primaryButtonText: { color: COLORS.white, fontSize: 15, fontWeight: "900" },
  secondaryButton: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingVertical: 14, alignItems: "center", width: "100%", marginTop: 10 },
  secondaryButtonText: { color: COLORS.white, fontSize: 15, fontWeight: "800" },
  calendarTitle: { color: COLORS.gold, fontSize: 18, fontWeight: "900", textAlign: "center", marginBottom: 10 },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
  dayName: { width: "14.285%", textAlign: "center", color: COLORS.muted, fontSize: 10, marginBottom: 8 },
  dayCell: { width: "14.285%", height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  dayCellCompact: { height: 28 },
  dayNum: { color: COLORS.white, fontSize: 15 },
  dayNumCompact: { fontSize: 13 },
  selectedDay: { backgroundColor: COLORS.redDark },
  proposedDay: { borderWidth: 1, borderColor: COLORS.blue },
  availableDay: { backgroundColor: "rgba(34, 197, 94, 0.28)", borderWidth: 1, borderColor: COLORS.green },
  unavailableDay: { backgroundColor: "rgba(220, 38, 38, 0.26)", borderWidth: 1, borderColor: COLORS.red },
  disabledDay: { opacity: 0.42 },
  activeDayText: { fontWeight: "900" },
  eventDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.blue, marginTop: 2 },
  goldDot: { backgroundColor: COLORS.gold },
  redDot: { backgroundColor: COLORS.red },
  dmOpenText: { color: COLORS.gold, fontSize: 9, fontWeight: "900", marginTop: 2 },
  legendRow: { flexDirection: "row", marginTop: 10, justifyContent: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", marginHorizontal: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: COLORS.muted, fontSize: 11, marginLeft: 6 },
  availabilityRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#1f1f1f" },
  responseButtons: { flexDirection: "row", flexWrap: "wrap", marginTop: 10 },
  voteButton: { borderWidth: 1, borderColor: COLORS.red, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginRight: 8, marginBottom: 8 },
  voteSelected: { backgroundColor: COLORS.redDark },
  voteButtonMuted: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  voteAvailable: { backgroundColor: "#166534", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginRight: 8 },
  voteUnavailable: { backgroundColor: COLORS.redDark, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  voteButtonText: { color: COLORS.white, fontSize: 11, fontWeight: "900" },
  voteMutedText: { color: COLORS.muted, fontSize: 11, fontWeight: "900" },
  quickGrid: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  quickAction: { width: "31.5%", minHeight: 92, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, padding: 10, justifyContent: "center", backgroundColor: "#0d0d0d" },
  quickLabel: { color: COLORS.white, fontSize: 12, fontWeight: "900", marginTop: 6 },
  quickDetail: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  searchRow: { marginBottom: 12 },
  searchText: { color: COLORS.muted, backgroundColor: COLORS.panel2, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 12, marginBottom: 10 },
  smallRedButton: { backgroundColor: COLORS.redDark, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, alignSelf: "flex-end" },
  smallRedButtonText: { color: COLORS.white, fontSize: 12, fontWeight: "900" },
  campaignCard: { flexDirection: "row", alignItems: "center" },
  campaignArt: { width: 74, height: 88, borderRadius: 10, marginRight: 12 },
  campaignInfo: { flex: 1 },
  campaignTitle: { color: COLORS.white, fontSize: 15, fontWeight: "900" },
  badge: { backgroundColor: COLORS.redDark, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, marginRight: 6 },
  badgeText: { color: COLORS.white, fontSize: 10, fontWeight: "900" },
  listHeading: { color: COLORS.white, fontSize: 16, fontWeight: "900", marginBottom: 10, marginTop: 4 },
  eventInfo: { flex: 1 },
  playerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#1f1f1f" },
  avatar: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#3f1d1d", alignItems: "center", justifyContent: "center", marginRight: 12 },
  avatarText: { color: COLORS.white, fontWeight: "900" },
  playerInfo: { flex: 1 },
  moreDots: { color: COLORS.muted, fontSize: 18 },
  quickAvailability: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  resultRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#1f1f1f" },
  resultInfo: { flex: 1, marginLeft: 10 },
  resultName: { color: COLORS.white, fontSize: 13, fontWeight: "800" },
  resultMeta: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  resultTotal: { backgroundColor: "#14532d", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  resultTotalText: { color: COLORS.white, fontWeight: "900" },
  detailsHero: { height: 145, borderRadius: 12, backgroundColor: "#0f2741", marginBottom: 14 },
  detailsTitle: { color: COLORS.white, fontSize: 22, fontWeight: "900" },
  infoLine: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  infoText: { color: COLORS.white, fontSize: 14, marginLeft: 10 },
  notesText: { color: COLORS.muted, lineHeight: 20, marginBottom: 16 },
  profileLogo: { width: 118, height: 118, alignSelf: "center", marginBottom: 14 },
  aboutHeroCard: { alignItems: "center", borderColor: COLORS.redDark },
  aboutLogo: { width: 150, height: 150, marginBottom: 12 },
  aboutTitle: { color: COLORS.gold, fontSize: 30, fontWeight: "900", textAlign: "center", marginBottom: 8 },
  aboutKicker: { color: "#fca5a5", fontSize: 11, fontWeight: "900", letterSpacing: 1.4, textAlign: "center", textTransform: "uppercase", marginBottom: 6 },
  aboutEyebrow: { color: "#fca5a5", fontSize: 11, fontWeight: "900", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 },
  aboutHeadline: { color: COLORS.white, fontSize: 25, fontWeight: "900", lineHeight: 31, marginBottom: 12 },
  aboutBody: { color: COLORS.muted, fontSize: 14, lineHeight: 23, marginBottom: 14 },
  aboutAmberCard: { borderColor: "#92400e", backgroundColor: "rgba(69, 26, 3, 0.38)" },
  aboutAmberHeadline: { color: "#fde68a", fontSize: 23, fontWeight: "900", lineHeight: 29, marginBottom: 10 },
  aboutMiniCard: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 12, padding: 12, marginTop: 10 },
  aboutMiniTitle: { color: COLORS.white, fontSize: 14, fontWeight: "900" },
  aboutMiniText: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  aboutPillGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 12 },
  aboutPill: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#090909", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginRight: 8, marginBottom: 8 },
  aboutPillText: { color: COLORS.white, fontSize: 12, fontWeight: "900" },
  aboutFeatureCard: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#090909", borderRadius: 12, padding: 13, marginTop: 10 },
  aboutFeatureTitle: { color: COLORS.white, fontSize: 15, fontWeight: "900" },
  aboutFeatureText: { color: COLORS.muted, fontSize: 12, lineHeight: 19, marginTop: 6 },
  aboutCtaCard: { borderColor: COLORS.redDark, backgroundColor: "rgba(69, 10, 10, 0.72)" },
  aboutFooter: { color: COLORS.muted, fontSize: 12, textAlign: "center", marginTop: 14 },
  settingsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1f1f1f" },
  logoutButton: { backgroundColor: "rgba(153, 27, 27, 0.25)", borderWidth: 1, borderColor: COLORS.red, borderRadius: 12, paddingVertical: 15, alignItems: "center", marginBottom: 12 },
  logoutText: { color: COLORS.red, fontSize: 16, fontWeight: "900" },
  deleteAccountButton: { backgroundColor: "rgba(127, 29, 29, 0.22)", borderWidth: 1, borderColor: "#7f1d1d", borderRadius: 12, paddingVertical: 15, alignItems: "center", marginBottom: 28 },
  deleteAccountText: { color: "#f87171", fontSize: 16, fontWeight: "900" },
  planTitle: { color: COLORS.gold, fontSize: 28, fontWeight: "900", marginTop: 8 },
  planPrice: { color: COLORS.gold, fontSize: 15, fontWeight: "900" },
  activePlanCard: { borderColor: COLORS.gold },
  activePlanButton: { backgroundColor: COLORS.gold, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  activePlanText: { color: "#111111", fontSize: 13, fontWeight: "900" },
  planFeatureRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  planCheck: { color: COLORS.green, fontSize: 14, fontWeight: "900", marginTop: 1, marginRight: 8 },
  planFeatureText: { color: COLORS.muted, fontSize: 12, flex: 1, lineHeight: 18 },
  billingToggleRow: { gap: 10, marginVertical: 12 },
  billingToggle: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, backgroundColor: "rgba(0,0,0,0.35)" },
  billingToggleActive: { borderColor: COLORS.gold, backgroundColor: "rgba(146, 64, 14, 0.35)" },
  billingToggleText: { color: COLORS.white, fontWeight: "900" },
  confirmBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.82)", alignItems: "center", justifyContent: "center", padding: 18 },
  confirmBox: { width: "100%", maxWidth: 420, backgroundColor: COLORS.bg, borderRadius: 18, borderWidth: 1, borderColor: COLORS.red, padding: 20 },
  confirmIcon: { color: COLORS.red, fontSize: 46, textAlign: "center", marginBottom: 8 },
  confirmTitle: { color: COLORS.white, fontSize: 24, fontWeight: "900", textAlign: "center", marginBottom: 10 },
  confirmText: { color: COLORS.muted, fontSize: 13, lineHeight: 20, textAlign: "center", marginBottom: 10 },
  confirmLabel: { color: COLORS.white, fontSize: 13, fontWeight: "800", marginTop: 8, marginBottom: 8 },
  deleteInput: { height: 48, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, color: COLORS.white, paddingHorizontal: 12, backgroundColor: COLORS.panel2, marginBottom: 12 },
  deleteConfirmButton: { backgroundColor: COLORS.redDark, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  disabledButton: { opacity: 0.4 },
  deleteConfirmText: { color: COLORS.white, fontSize: 15, fontWeight: "900" },
  cancelDeleteButton: { backgroundColor: COLORS.panel2, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 10 },
  cancelDeleteText: { color: COLORS.white, fontSize: 15, fontWeight: "800" },
  editableField: { marginBottom: 14 },
  fieldLabel: { color: COLORS.gold, fontSize: 13, fontWeight: "900", marginBottom: 7 },
  fieldInput: { minHeight: 48, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.panel2, color: COLORS.white, paddingHorizontal: 12 },
  errorText: { color: "#fca5a5", fontSize: 13, textAlign: "center", marginTop: 14, lineHeight: 18 },
  syncBanner: { position: "absolute", left: 12, right: 12, bottom: 88, zIndex: 30, backgroundColor: "#3b1f06", borderWidth: 1, borderColor: COLORS.amber, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12 },
  syncBannerText: { color: COLORS.gold, fontSize: 12, fontWeight: "800", textAlign: "center" },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: Platform.OS === "android" ? 92 : 96,
    paddingBottom: Platform.OS === "android" ? 20 : 28,
    paddingTop: 10,
    paddingHorizontal: 6,
    backgroundColor: "rgba(5,5,5,0.99)",
    borderTopWidth: 1,
    borderTopColor: "#171717",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center" },
  navIcon: { color: COLORS.muted, fontSize: 20, lineHeight: 22 },
  navLabel: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  navActive: { color: COLORS.red },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" },
  drawer: { maxHeight: "88%", backgroundColor: COLORS.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30, borderWidth: 1, borderColor: COLORS.border },
  drawerScrollContent: { paddingBottom: 24 },
  drawerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  drawerTitle: { color: COLORS.white, fontSize: 24, fontWeight: "900" },
  closeText: { color: COLORS.white, fontSize: 34 },
  menuGroup: { color: COLORS.white, fontSize: 13, fontWeight: "900", textTransform: "uppercase", marginBottom: 8 },
  menuItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "#1f1f1f" },
  menuItemText: { color: COLORS.white, fontSize: 15 },
});
