import React, { useEffect, useMemo, useState } from "react";
import { createUserWithEmailAndPassword, fetchSignInMethodsForEmail, linkWithCredential, signInWithEmailAndPassword, signOut, onAuthStateChanged, EmailAuthProvider, GoogleAuthProvider, signInWithPopup, deleteUser } from "firebase/auth";
import { collection, deleteDoc, doc, getDoc, getDocs, getFirestore, onSnapshot, setDoc } from "firebase/firestore";
import app, { auth as firebaseAuth } from "./firebase";
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";

const firebaseDb = getFirestore(app);
const firebaseStorage = getStorage(app);
const TOKEN_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const STRIPE_API_BASE_URL = "https://www.dungeoncalendar.com";



function sanitizeTokenFileName(name = "token") {
  return String(name || "token").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-80) || "token";
}

function getTokenImageSrc(tokenImage) {
  if (!tokenImage) return "";
  if (typeof tokenImage === "string") return tokenImage;
  return tokenImage.url || tokenImage.downloadURL || "";
}

function arrayIncludesValue(values = [], value = "") {
  return Array.isArray(values) && values.includes(value);
}

function normalizeList(values = []) {
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

function normalizeCampaign(campaign = {}) {
  const id = campaign.id || makeId("campaign");
  return {
    id,
    name: campaign.name || "Unnamed Campaign",
    ownerId: campaign.ownerId || campaign.createdBy || campaign.dmId || "",
    dungeonMasterIds: normalizeList(campaign.dungeonMasterIds || campaign.dmIds || []),
    memberIds: normalizeList(campaign.memberIds || campaign.members || campaign.playerIds || []),
    invitedEmails: normalizeList(campaign.invitedEmails || []),
    leftUserIds: normalizeList(campaign.leftUserIds || campaign.removedUserIds || []),
    archived: !!campaign.archived,
    deleted: !!campaign.deleted,
    status: campaign.status || "active",
    availability: campaign.availability || {},
    unavailable: campaign.unavailable || {},
    chosenDate: campaign.chosenDate || "",
    sessionTime: campaign.sessionTime || "18:00",
    sessionDuration: campaign.sessionDuration || 4,
    reminderHours: campaign.reminderHours || 24,
    updatedAt: campaign.updatedAt || new Date().toISOString()
  };
}

function isCampaignActiveForUser(campaign, user, player) {
  if (!campaign || !user) return false;
  const normalized = normalizeCampaign(campaign);
  const uid = user.id || "";
  const email = normalizeEmail(user.email || "");
  if (normalized.deleted || normalized.archived || normalized.status === "inactive" || normalized.status === "deleted" || normalized.status === "archived") return false;
  if (arrayIncludesValue(normalized.leftUserIds, uid)) return false;
  return normalized.ownerId === uid ||
    arrayIncludesValue(normalized.dungeonMasterIds, uid) ||
    arrayIncludesValue(normalized.memberIds, uid) ||
    arrayIncludesValue(player?.campaignIds || [], normalized.id) ||
    (!!email && arrayIncludesValue(normalized.invitedEmails.map(normalizeEmail), email));
}

async function saveCampaignToFirestore(campaign) {
  if (!campaign?.id) return false;
  try {
    const normalized = normalizeCampaign({ ...campaign, updatedAt: new Date().toISOString() });
    await setDoc(doc(firebaseDb, "campaigns", normalized.id), normalized, { merge: true });
    return true;
  } catch (error) {
    console.warn("Firestore campaign save failed; local state will still update:", error);
    return false;
  }
}


async function mergeUserProfilesByEmail(uid, email, profile = {}) {
  const cleanEmail = normalizeEmail(email || profile?.email || "");
  if (!uid || !cleanEmail) return profile || {};

  let mergedProfile = {
    ...(profile || {}),
    id: uid,
    email: cleanEmail,
    linkedEmail: cleanEmail,
    linkedProviders: Array.from(new Set([...(profile?.linkedProviders || []), ...(firebaseAuth.currentUser?.providerData || []).map((item) => item.providerId)])),
    updatedAt: new Date().toISOString()
  };

  try {
    const snap = await getDocs(collection(firebaseDb, "users"));
    const duplicates = [];
    snap.forEach((entry) => {
      const data = entry.data() || {};
      if (entry.id !== uid && normalizeEmail(data.email || data.linkedEmail || "") === cleanEmail) {
        duplicates.push({ id: entry.id, data });
      }
    });

    for (const duplicate of duplicates) {
      mergedProfile = {
        ...duplicate.data,
        ...mergedProfile,
        id: uid,
        email: cleanEmail,
        campaignIds: Array.from(new Set([...(duplicate.data.campaignIds || []), ...(mergedProfile.campaignIds || [])])),
        lockedColorCampaignIds: Array.from(new Set([...(duplicate.data.lockedColorCampaignIds || []), ...(mergedProfile.lockedColorCampaignIds || [])])),
        campaignCharacterNames: { ...(duplicate.data.campaignCharacterNames || {}), ...(mergedProfile.campaignCharacterNames || {}) },
        campaignTokenImages: { ...(duplicate.data.campaignTokenImages || {}), ...(mergedProfile.campaignTokenImages || {}) },
        linkedProviders: Array.from(new Set([...(duplicate.data.linkedProviders || []), ...(mergedProfile.linkedProviders || [])])),
        mergedFromUserIds: Array.from(new Set([...(duplicate.data.mergedFromUserIds || []), duplicate.id, ...(mergedProfile.mergedFromUserIds || [])])),
        updatedAt: new Date().toISOString()
      };
      await deleteDoc(doc(firebaseDb, "users", duplicate.id)).catch((error) => console.warn("Could not delete duplicate user profile", duplicate.id, error));
    }

    await setDoc(doc(firebaseDb, "users", uid), mergedProfile, { merge: true });
  } catch (error) {
    console.warn("Profile merge by email failed; continuing with signed-in account:", error);
  }

  return mergedProfile;
}

async function loadUserProfileFromFirestore(uid) {
  try {
    const ref = doc(firebaseDb, "users", uid);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    console.warn("Firestore profile load failed; continuing with Firebase Auth only:", error);
    return null;
  }
}

async function saveUserProfileToFirestore(uid, profile) {
  try {
    const ref = doc(firebaseDb, "users", uid);
    await setDoc(ref, profile, { merge: true });
    return true;
  } catch (error) {
    console.warn("Firestore profile save failed; login will still continue:", error);
    return false;
  }
}

function authErrorMessage(error) {
  const code = error?.code || "";
  if (code === "auth/configuration-not-found") return "Firebase Email/Password sign-in is not enabled. Open Firebase Console > Authentication > Sign-in method and enable Email/Password.";
  if (code === "auth/email-already-in-use") return "An account already exists for that email. Switch to Log In.";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password") return "Incorrect email or password.";
  if (code === "auth/user-not-found") return "No account found. Use Create Account first.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/weak-password") return "Password must be at least 6 characters.";
  if (code === "auth/network-request-failed") return "Network error. Check your connection and try again.";
  return error?.message || "Authentication failed.";
}

const logoUrl = "https://dl.dropboxusercontent.com/scl/fi/zbs7u6pu228z00a85o3zp/Dungion-calender-1.png?rlkey=uzhr4177misvyogjocby6l7h0";
const backgroundUrl = "https://dl.dropboxusercontent.com/scl/fi/pcz1w86zi9ba1z7b6bb4d/360_F_421852062_oLJjfT88cczyu3u28Qy3M2V8xmO8L770.jpg?rlkey=205zonrdob2sp4d39bncbx3jg";

const PLAN_ORDER = ["free", "adventurer", "guildmaster"];

const PLANS = {
  free: {
    name: "Free",
    campaigns: 1,
    characters: 1,
    price: "$0",
    features: [
      "1 active campaign",
      "1 playable character",
      "Shared scheduling calendar",
      "Session reminders",
      "Player invite tools",
      "Manual final date selection"
    ]
  },
  adventurer: {
    name: "Adventurer",
    campaigns: 5,
    characters: 5,
    price: "$2.99/mo",
    features: [
      "Up to 5 campaigns",
      "Up to 5 unique characters",
      "Shared scheduling calendar",
      "Session reminders",
      "Player invite tools",
      "Manual final date selection",
      "Automatic best-date voting",
      "Calendar export support"
    ]
  },
  guildmaster: {
    name: "Guildmaster",
    campaigns: Infinity,
    characters: Infinity,
    price: "$4.99/mo",
    features: [
      "Unlimited campaigns",
      "Unlimited characters",
      "Shared scheduling calendar",
      "Session reminders",
      "Player invite tools",
      "Manual final date selection",
      "Automatic best-date voting",
      "Calendar export support",
      "Full party availability tracking",
      "Advanced campaign controls",
      "Custom player token image uploads",
      "Priority access to future premium features"
    ]
  }
};

const COLORS = ["#22c55e", "#38bdf8", "#a855f7", "#f97316", "#14b8a6", "#facc15", "#ec4899", "#6366f1"];
const PAYMENT_METHODS = ["Card", "Stripe", "Shopify", "PayPal", "Google Pay", "Apple Pay"];

function makeId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeCampaign(name = "First Campaign", dungeonMasterIds = [], ownerId = "") {
  const id = makeId("campaign");
  return normalizeCampaign({
    id,
    name,
    ownerId: ownerId || dungeonMasterIds[0] || "",
    dungeonMasterIds,
    memberIds: dungeonMasterIds,
    availability: {},
    unavailable: {},
    chosenDate: "",
    sessionTime: "18:00",
    sessionDuration: 4,
    reminderHours: 24,
    status: "active"
  });
}

function todayKey(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function monthLabel(date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function buildCalendarMonth(viewDate) {
  const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function dateLabel(key) {
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function firstName(name = "Player") {
  return String(name || "Player").trim().split(/\s+/)[0] || "Player";
}

function planRank(planId) {
  return PLAN_ORDER.indexOf(planId);
}

function planActionLabel(currentPlan, targetPlan) {
  if (currentPlan === targetPlan) return "Active";
  return planRank(targetPlan) > planRank(currentPlan)
    ? `Upgrade to ${PLANS[targetPlan].name}`
    : `Downgrade to ${PLANS[targetPlan].name}`;
}

function planLimitText(value) {
  return value === Infinity ? "∞" : value;
}

function getDateScore(campaign, key) {
  const available = campaign?.availability?.[key] || [];
  const unavailable = campaign?.unavailable?.[key] || [];
  const dmAvailable = available.some((id) => campaign?.dungeonMasterIds?.includes(id));
  const dmUnavailable = unavailable.some((id) => campaign?.dungeonMasterIds?.includes(id));

  return {
    key,
    availableCount: available.length,
    unavailableCount: unavailable.length,
    totalResponses: available.length + unavailable.length,
    dmAvailable,
    dmUnavailable,
    score: dmAvailable ? available.length - unavailable.length : -999
  };
}

function getRankedDateResults(campaign) {
  const keys = Array.from(
    new Set([
      ...Object.keys(campaign?.availability || {}),
      ...Object.keys(campaign?.unavailable || {})
    ])
  );

  return keys
    .map((key) => getDateScore(campaign, key))
    .filter((result) => result.dmAvailable)
    .sort((a, b) => b.score - a.score || b.availableCount - a.availableCount || a.key.localeCompare(b.key));
}

function getDateRankLabel(campaign, key) {
  const ranked = getRankedDateResults(campaign);
  const index = ranked.findIndex((item) => item.key === key);

  if (index === -1) return "Date Option";
  if (index === 0) return "Best Date";
  if (index === 1) return "Second Best";
  if (index === ranked.length - 1) return "Worst Date";
  if (index === ranked.length - 2) return "Second Worst";

  return `Rank #${index + 1}`;
}

function getBestDateKey(campaign) {
  return getRankedDateResults(campaign)[0]?.key || "";
}

function autoPickBestDate(campaign) {
  return getBestDateKey(campaign);
}

function makeCalendarLinks(campaign, name = "Dungeon Calendar") {
  if (!campaign?.chosenDate) return null;

  const start = new Date(`${campaign.chosenDate}T${campaign.sessionTime || "18:00"}:00`);
  const end = new Date(start);
  end.setHours(end.getHours() + Number(campaign.sessionDuration || 4));

  const fmt = (date) => date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const title = `${campaign.name || name} Session`;
  const details = `Final session date chosen in Dungeon Calendar. Reminder: ${campaign.reminderHours || 24} hour(s) before.`;
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${fmt(start)}/${fmt(end)}&details=${encodeURIComponent(details)}`;
  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(title)}&startdt=${encodeURIComponent(start.toISOString())}&enddt=${encodeURIComponent(end.toISOString())}&body=${encodeURIComponent(details)}`;

  return { google, outlook, apple: "Apple Calendar imports the downloaded .ics file in the full app." };
}

function formatCard(value) {
  const raw = String(value || "").replace(/\D/g, "");
  const isAmex = /^3[47]/.test(raw);
  const digits = raw.slice(0, isAmex ? 15 : 16);

  if (isAmex) {
    return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10)].filter(Boolean).join(" ");
  }

  return digits.match(/.{1,4}/g)?.join(" ") || digits;
}

function formatExpiry(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

function safeReadStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable in some previews.
  }
}

function normalizeProfileForStorage(player) {
  return {
    username: player?.username || "",
    name: player?.name || "",
    email: player?.email || "",
    phone: player?.phone || "",
    password: player?.password || ""
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isClaimableInvite(player) {
  return !player?.password || player.password === "dungeon" || player.invitePending === true;
}

function getCalendarVisual({ dmAvailable, dmUnavailable, selected, final }) {
  if (final) return "final";
  if (dmAvailable) return "dmAvailable";
  if (dmUnavailable) return "dmUnavailable";
  if (selected) return "selected";
  return "locked";
}

function dashboardSummary({ activeCampaignPlayers = [], selectedDateAvailability = [], selectedDateUnavailable = [], plan = "free", isDungeonMaster = false }) {
  return {
    players: activeCampaignPlayers.length,
    available: selectedDateAvailability.length,
    unavailable: selectedDateUnavailable.length,
    planName: PLANS[plan]?.name || "Free",
    role: isDungeonMaster ? "Dungeon Master" : "Player"
  };
}

function runSelfTests() {
  console.assert(buildCalendarMonth(new Date("2026-01-15T00:00:00")).length === 42, "Calendar month should render 42 cells");
  console.assert(buildCalendarMonth(new Date("2026-01-15T00:00:00"))[0].getDay() === 0, "Calendar month should start on Sunday");
  console.assert(firstName("Arannis Moonbrook") === "Arannis", "firstName should return first word");
  console.assert(planActionLabel("free", "adventurer") === "Upgrade to Adventurer", "free to adventurer should be upgrade");
  console.assert(planActionLabel("guildmaster", "adventurer") === "Downgrade to Adventurer", "guildmaster to adventurer should be downgrade");
  console.assert(formatCard("4242424242424242") === "4242 4242 4242 4242", "Visa-like cards should format as 4-4-4-4");
  console.assert(formatCard("378282246310005") === "3782 822463 10005", "Amex should format as 4-6-5");
  console.assert(formatExpiry("1228") === "12/28", "Expiration should auto-insert slash");

  const testCampaign = {
    dungeonMasterIds: ["dm"],
    availability: {
      "2026-01-01": ["dm", "p1"],
      "2026-01-02": ["dm", "p1", "p2"]
    }
  };

  console.assert(autoPickBestDate(testCampaign) === "2026-01-02", "autoPickBestDate should pick most votes with DM availability");
  console.assert(getDateScore(testCampaign, "2026-01-02").availableCount === 3, "Date score should count available players");
  console.assert(getDateRankLabel(testCampaign, "2026-01-02") === "Best Date", "Highest ranked date should be Best Date");
  console.assert(PLANS.guildmaster.features.includes("Custom player token image uploads"), "Guildmaster should include token uploads");
  console.assert(safeReadStorage("missing-test-key", "fallback") === "fallback", "safeReadStorage should return fallback for missing keys");
  console.assert(normalizeProfileForStorage({ username: "rogue", name: "Rogue One", email: "r@test.com", phone: "555", password: "pw" }).username === "rogue", "Profile storage should keep username");
  console.assert(normalizeEmail(" Test@Email.COM ") === "test@email.com", "Email should normalize before account lookup");
  console.assert(isClaimableInvite({ password: "dungeon" }) === true, "Invited default-password accounts should be claimable during registration");
  console.assert(getCalendarVisual({ dmAvailable: true, dmUnavailable: false, selected: false, final: false }) === "dmAvailable", "DM available dates should be visually green");
  console.assert(getCalendarVisual({ dmAvailable: false, dmUnavailable: true, selected: false, final: false }) === "dmUnavailable", "DM unavailable dates should be visually red");
  console.assert(dashboardSummary({ activeCampaignPlayers: [1, 2], selectedDateAvailability: [1], selectedDateUnavailable: [], plan: "adventurer", isDungeonMaster: true }).role === "Dungeon Master", "Dashboard summary should show DM role");
}

runSelfTests();

export default function DungeonCalendarMobileApp() {
  const savedState = useMemo(() => safeReadStorage("dungeon-calendar-mobile-state", null), []);

  const [screen, setScreen] = useState(savedState?.currentUserId ? "dashboard" : "login");
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState(savedState?.rememberMe ? savedState?.savedEmail || "" : "");
  const [password, setPassword] = useState(savedState?.rememberMe ? savedState?.savedPassword || "" : "");
  const [name, setName] = useState("");
  const [rememberMe, setRememberMe] = useState(!!savedState?.rememberMe);
  const [plan, setPlan] = useState(savedState?.plan || "free");
  const [players, setPlayers] = useState(savedState?.players || []);
  const [currentUserId, setCurrentUserId] = useState(savedState?.currentUserId || "");
  const [campaigns, setCampaigns] = useState(() => savedState?.campaigns || [makeCampaign()]);
  const [activeCampaignId, setActiveCampaignId] = useState(savedState?.activeCampaignId || "");
  const [availabilityMode, setAvailabilityMode] = useState("available");
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [message, setMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [accountUsername, setAccountUsername] = useState(savedState?.savedProfile?.username || "");
  const [accountPhone, setAccountPhone] = useState(savedState?.savedProfile?.phone || "");
  const [accountName, setAccountName] = useState(savedState?.savedProfile?.name || "");
  const [accountEmail, setAccountEmail] = useState(savedState?.savedProfile?.email || "");
  const [accountPassword, setAccountPassword] = useState(savedState?.savedProfile?.password || "");
  const [selectedCheckoutPlan, setSelectedCheckoutPlan] = useState("");
  const [selectedBillingInterval, setSelectedBillingInterval] = useState("monthly");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("Card");
  const [paymentCard, setPaymentCard] = useState("");
  const [paymentExpiry, setPaymentExpiry] = useState("");
  const [paymentCvc, setPaymentCvc] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [campaignsRemoteReady, setCampaignsRemoteReady] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  useEffect(() => {
    safeWriteStorage("dungeon-calendar-mobile-state", {
      players,
      campaigns,
      plan,
      activeCampaignId,
      rememberMe,
      currentUserId,
      savedEmail: rememberMe ? email : "",
      savedPassword: rememberMe ? password : "",
      savedProfile: currentUserId
        ? normalizeProfileForStorage(players.find((player) => player.id === currentUserId))
        : null
    });
  }, [players, campaigns, plan, activeCampaignId, rememberMe, currentUserId, email, password]);

  const currentUser = players.find((player) => player.id === currentUserId);
  const visibleCampaigns = useMemo(() => {
    if (!currentUser) return [];
    return campaigns
      .map(normalizeCampaign)
      .filter((campaign) => isCampaignActiveForUser(campaign, currentUser, currentUser));
  }, [campaigns, currentUser]);
  const activeCampaign = visibleCampaigns.find((campaign) => campaign.id === activeCampaignId) || visibleCampaigns[0] || null;
  const isDungeonMaster = !!currentUser && !!activeCampaign?.dungeonMasterIds?.includes(currentUser.id);
  const nextDates = useMemo(() => Array.from({ length: 35 }, (_, index) => todayKey(index)), []);
  const calendarMonthDays = useMemo(() => buildCalendarMonth(viewDate), [viewDate]);
  const activeCampaignPlayers = activeCampaign ? players.filter((player) =>
    player.campaignIds?.includes(activeCampaign.id) || activeCampaign.dungeonMasterIds?.includes(player.id) || activeCampaign.memberIds?.includes(player.id)
  ).filter((player, index, list) => {
    const key = normalizeEmail(player.email) || `${String(player.name || "").trim().toLowerCase()}-${activeCampaign.dungeonMasterIds?.includes(player.id) ? "dm" : "player"}` || player.id;
    return index === list.findIndex((candidate) => {
      const candidateKey = normalizeEmail(candidate.email) || `${String(candidate.name || "").trim().toLowerCase()}-${activeCampaign.dungeonMasterIds?.includes(candidate.id) ? "dm" : "player"}` || candidate.id;
      return candidateKey === key;
    });
  }) : [];
  const selectedDateAvailability = activeCampaign?.chosenDate ? activeCampaign.availability?.[activeCampaign.chosenDate] || [] : [];
  const selectedDateUnavailable = activeCampaign?.chosenDate ? activeCampaign.unavailable?.[activeCampaign.chosenDate] || [] : [];
  const calendarLinks = makeCalendarLinks(activeCampaign);


  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      if (!user) {
        setAuthReady(true);
        return;
      }

      try {
        const profile = await loadUserProfileFromFirestore(user.uid);

        if (profile) {
          const firebasePlayer = {
            id: user.uid,
            name: profile.name || user.displayName || user.email || "Player",
            username: profile.username || profile.name?.toLowerCase?.().replace(/\s+/g, "") || user.email?.split("@")[0] || "player",
            email: profile.email || user.email || "",
            password: "",
            phone: profile.phone || "",
            campaignIds: profile.campaignIds || [],
            campaignCharacterNames: profile.campaignCharacterNames || {},
            lockedColorCampaignIds: profile.lockedColorCampaignIds || [],
            color: profile.color || COLORS[players.length % COLORS.length],
            campaignTokenImages: profile.campaignTokenImages || {}
          };

          setPlayers((current) => {
            const exists = current.some((player) => player.id === user.uid);
            return exists
              ? current.map((player) => player.id === user.uid ? { ...player, ...firebasePlayer } : player)
              : [...current, firebasePlayer];
          });
        }

        setCurrentUserId(user.uid);
      } catch (error) {
        console.error("Failed to restore Firebase login:", error);
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, []);



  useEffect(() => {
    if (!authReady || !currentUserId || firebaseAuth.currentUser?.uid !== currentUserId) return;

    const params = new URLSearchParams(window.location.search);
    const stripeSuccess = params.get("stripe_success") === "true";
    const stripeCancelled = params.get("stripe_cancelled") === "true" || params.get("checkout_cancelled") === "true";
    const returnedPlan = String(params.get("stripe_plan") || "").toLowerCase();
    const returnedBillingInterval = String(params.get("stripe_billing") || params.get("billing") || "monthly").toLowerCase() === "yearly" ? "yearly" : "monthly";

    if (stripeCancelled) {
      showMessage("Stripe Checkout was cancelled. No plan changes were made.");
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (!stripeSuccess) return;

    const safePlan = ["adventurer", "guildmaster"].includes(returnedPlan) ? returnedPlan : "";
    if (!safePlan) {
      showMessage("Stripe returned successfully. Waiting for subscription confirmation...");
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    setPlan(safePlan);
    saveUserProfileToFirestore(currentUserId, {
      plan: safePlan,
      billingInterval: returnedBillingInterval,
      pendingStripePlan: "free",
      pendingStripeBillingInterval: "monthly",
      pendingStripeStartedAt: "",
      stripeActivationSource: "mobile_stripe_return",
      stripePaymentLinkActivatedAt: new Date().toISOString()
    }).catch((error) => console.warn("Mobile Stripe return plan sync failed:", error));
    showMessage(`${PLANS[safePlan]?.name || "Paid"} plan activated.`);
    window.history.replaceState({}, document.title, window.location.pathname);
  }, [authReady, currentUserId]);

  useEffect(() => {
    if (!authReady || !currentUserId || firebaseAuth.currentUser?.uid !== currentUserId) return undefined;

    const userRef = doc(firebaseDb, "users", currentUserId);
    const unsubscribeProfile = onSnapshot(userRef, (snapshot) => {
      if (!snapshot.exists()) return;

      const profile = snapshot.data();
      const remotePlan = String(profile.plan || "free").toLowerCase();
      if (["free", "adventurer", "guildmaster"].includes(remotePlan)) {
        setPlan(remotePlan);
      }
      if (profile.email) setAccountEmail(profile.email);
      if (profile.name) setAccountName(profile.name);
      if (profile.username) setAccountUsername(profile.username);
      if (profile.phone) setAccountPhone(profile.phone);

      const syncedPlayer = {
        id: currentUserId,
        name: profile.name || firebaseAuth.currentUser?.displayName || firebaseAuth.currentUser?.email || "Player",
        username: profile.username || profile.name?.toLowerCase?.().replace(/\s+/g, "") || firebaseAuth.currentUser?.email?.split("@")[0] || "player",
        email: profile.email || firebaseAuth.currentUser?.email || "",
        password: "",
        phone: profile.phone || "",
        campaignIds: profile.campaignIds || [],
        campaignCharacterNames: profile.campaignCharacterNames || {},
        lockedColorCampaignIds: profile.lockedColorCampaignIds || [],
        color: profile.color || COLORS[players.length % COLORS.length],
        campaignTokenImages: profile.campaignTokenImages || {}
      };

      setPlayers((current) => {
        const withoutDuplicate = current.filter((player) =>
          player.id !== currentUserId && normalizeEmail(player.email) !== normalizeEmail(syncedPlayer.email)
        );
        return [...withoutDuplicate, syncedPlayer];
      });
    }, (error) => {
      console.warn("Mobile live profile sync failed:", error);
    });

    return () => unsubscribeProfile();
  }, [authReady, currentUserId]);

  useEffect(() => {
    if (!authReady || !currentUserId || !currentUser || firebaseAuth.currentUser?.uid !== currentUserId) return;
    setCampaignsRemoteReady(false);

    const unsubscribeCampaigns = onSnapshot(collection(firebaseDb, "campaigns"), (snapshot) => {
      const remoteCampaigns = snapshot.docs
        .map((docSnapshot) => normalizeCampaign({ id: docSnapshot.id, ...docSnapshot.data() }))
        .filter((campaign) => isCampaignActiveForUser(campaign, currentUser, currentUser));

      setCampaigns((current) => {
        const merged = new Map();
        remoteCampaigns.forEach((campaign) => merged.set(campaign.id, campaign));
        current.map(normalizeCampaign).forEach((campaign) => {
          if (!isCampaignActiveForUser(campaign, currentUser, currentUser)) return;
          if (!merged.has(campaign.id)) merged.set(campaign.id, campaign);
        });
        return Array.from(merged.values());
      });

      if (remoteCampaigns.length && (!activeCampaignId || !remoteCampaigns.some((campaign) => campaign.id === activeCampaignId))) {
        setActiveCampaignId(remoteCampaigns[0].id);
      }
      setCampaignsRemoteReady(true);
    }, (error) => {
      console.warn("Mobile campaign sync failed; using cached campaigns:", error);
      setCampaigns((current) => current.map(normalizeCampaign).filter((campaign) => isCampaignActiveForUser(campaign, currentUser, currentUser)));
      setCampaignsRemoteReady(true);
    });

    return () => unsubscribeCampaigns();
  }, [authReady, currentUserId, currentUser?.email, JSON.stringify(currentUser?.campaignIds || [])]);

  useEffect(() => {
    if (!campaignsRemoteReady || !authReady || !currentUserId || !currentUser || firebaseAuth.currentUser?.uid !== currentUserId) return;
    const activeForUser = campaigns.map(normalizeCampaign).filter((campaign) => isCampaignActiveForUser(campaign, currentUser, currentUser));
    activeForUser.forEach((campaign) => saveCampaignToFirestore(campaign));
  }, [campaignsRemoteReady, campaigns, authReady, currentUserId, currentUser?.email, JSON.stringify(currentUser?.campaignIds || [])]);

  useEffect(() => {
    if (!authReady || !currentUserId || firebaseAuth.currentUser?.uid !== currentUserId) return;
    const player = players.find((item) => item.id === currentUserId);
    if (!player) return;

    saveUserProfileToFirestore(currentUserId, {
      username: player.username || "",
      name: player.name || "",
      email: player.email || "",
      phone: player.phone || "",
      campaignIds: player.campaignIds || [],
      campaignCharacterNames: player.campaignCharacterNames || {},
      color: player.color || "",
      lockedColorCampaignIds: player.lockedColorCampaignIds || [],
      campaignTokenImages: player.campaignTokenImages || {}
    }).catch((error) => console.error("Failed to sync mobile profile:", error));
  }, [players, currentUserId]);

  useEffect(() => {
    if (!currentUser) return;

    setAccountUsername(currentUser.username || "");
    setAccountName(currentUser.name || "");
    setAccountEmail(currentUser.email || "");
    setAccountPhone(currentUser.phone || "");
    setAccountPassword(currentUser.password || "");
  }, [currentUserId]);

  function showMessage(text) {
    setMessage(text);
    window.clearTimeout(showMessage.timer);
    showMessage.timer = window.setTimeout(() => setMessage(""), 3000);
  }

  function updateCurrentPlayer(updates) {
    setPlayers((current) => current.map((player) => (player.id === currentUserId ? { ...player, ...updates } : player)));
  }

  async function finishGoogleUserLogin(firebaseUser) {
    const cleanEmail = normalizeEmail(firebaseUser?.email || email);
    const uid = firebaseUser?.uid;
    if (!uid) throw new Error("Google sign-in did not return a Firebase user.");

    const profile = await loadUserProfileFromFirestore(uid).catch(() => null);
    const existingLocal = players.find((item) => item.id === uid || normalizeEmail(item.email) === cleanEmail);
    const fallbackName = firebaseUser?.displayName || existingLocal?.name || cleanEmail || "Google User";
    const fallbackCampaignId = existingLocal?.campaignIds?.[0] || activeCampaign?.id || campaigns?.[0]?.id || "";

    const player = {
      id: uid,
      name: profile?.name || fallbackName,
      username: profile?.username || existingLocal?.username || cleanEmail?.split("@")[0] || fallbackName.toLowerCase().replace(/\s+/g, ""),
      email: profile?.email || cleanEmail || "",
      password: "",
      phone: profile?.phone || existingLocal?.phone || "",
      campaignIds: profile?.campaignIds || existingLocal?.campaignIds || (fallbackCampaignId ? [fallbackCampaignId] : []),
      campaignCharacterNames: profile?.campaignCharacterNames || existingLocal?.campaignCharacterNames || (fallbackCampaignId ? { [fallbackCampaignId]: "" } : {}),
      lockedColorCampaignIds: profile?.lockedColorCampaignIds || existingLocal?.lockedColorCampaignIds || [],
      color: profile?.color || existingLocal?.color || COLORS[players.length % COLORS.length],
      campaignTokenImages: profile?.campaignTokenImages || existingLocal?.campaignTokenImages || {},
      lastLoginProvider: firebaseUser?.providerData?.[0]?.providerId || "google.com"
    };

    const mergedPlayer = await mergeUserProfilesByEmail(uid, cleanEmail, player);
    Object.assign(player, mergedPlayer);

    setPlayers((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== uid && normalizeEmail(item.email) !== cleanEmail);
      return [...withoutDuplicate, player];
    });

    setCurrentUserId(uid);
    if (player.campaignIds?.[0]) setActiveCampaignId(player.campaignIds[0]);
    setAccountUsername(player.username || "");
    setAccountName(player.name || "");
    setAccountEmail(player.email || "");
    setAccountPhone(player.phone || "");
    setAccountPassword("");
    setScreen("dashboard");

    saveUserProfileToFirestore(uid, player).catch((error) => console.warn("Google profile sync failed:", error));
  }

  async function signInWithGoogle() {
    if (authBusy) return;
    setAuthBusy(true);
    setMessage("");

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const credential = await signInWithPopup(firebaseAuth, provider);
      await finishGoogleUserLogin(credential.user);
      showMessage("Signed in with Google.");
    } catch (error) {
      console.error("Google sign-in failed:", error);
      const pendingGoogleCredential = GoogleAuthProvider.credentialFromError?.(error);
      const conflictEmail = normalizeEmail(error?.customData?.email || "");
      if (error?.code === "auth/account-exists-with-different-credential" && pendingGoogleCredential && conflictEmail && password) {
        try {
          const existing = await signInWithEmailAndPassword(firebaseAuth, conflictEmail, password);
          await linkWithCredential(existing.user, pendingGoogleCredential);
          await finishGoogleUserLogin(existing.user);
          showMessage("Google sign-in linked to your existing account.");
        } catch (linkError) {
          showMessage("Google uses the same email as an existing password account. Enter that password, then try Continue with Google again.");
        }
      } else {
        const message = error?.code === "auth/popup-closed-by-user"
          ? "Google sign-in was cancelled."
          : error?.code === "auth/operation-not-supported-in-this-environment"
            ? "Google sign-in must open in a browser window for this mobile web build."
            : error?.message || "Google sign-in failed.";
        showMessage(message);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function signIn() {
    if (authBusy) return;
    setAuthBusy(true);
    setMessage("");
    const cleanEmail = normalizeEmail(email);

    if (!cleanEmail || !password.trim()) {
      showMessage("Enter your email and password.");
      setAuthBusy(false);
      return;
    }

    try {
      let uid = "";
      let player;

      if (authMode === "register") {
        if (!name.trim()) {
          showMessage("Enter your name to create an account.");
          setAuthBusy(false);
          return;
        }

        const credential = await createUserWithEmailAndPassword(firebaseAuth, cleanEmail, password);
        uid = credential.user.uid;
        const existingInvite = players.find((item) => normalizeEmail(item.email) === cleanEmail);

        player = {
          id: uid,
          name: name.trim(),
          username: existingInvite?.username || name.trim().toLowerCase().replace(/\s+/g, ""),
          email: cleanEmail,
          password: "",
          phone: existingInvite?.phone || "",
          campaignIds: existingInvite?.campaignIds?.length ? existingInvite.campaignIds : [activeCampaign.id],
          campaignCharacterNames: existingInvite?.campaignCharacterNames || { [activeCampaign.id]: "" },
          lockedColorCampaignIds: existingInvite?.lockedColorCampaignIds || [],
          color: existingInvite?.color || COLORS[players.length % COLORS.length],
          campaignTokenImages: existingInvite?.campaignTokenImages || {},
          invitePending: false
        };

        player = await mergeUserProfilesByEmail(uid, cleanEmail, player);
        await saveUserProfileToFirestore(uid, player);
      } else {
        const credential = await signInWithEmailAndPassword(firebaseAuth, cleanEmail, password);
        uid = credential.user.uid;
        const profile = await loadUserProfileFromFirestore(uid);
        const existingLocal = players.find((item) => item.id === uid || normalizeEmail(item.email) === cleanEmail);

        player = {
          id: uid,
          name: profile?.name || existingLocal?.name || credential.user.displayName || cleanEmail,
          username: profile?.username || existingLocal?.username || cleanEmail.split("@")[0],
          email: profile?.email || cleanEmail,
          password: "",
          phone: profile?.phone || existingLocal?.phone || "",
          campaignIds: profile?.campaignIds || existingLocal?.campaignIds || [activeCampaign.id],
          campaignCharacterNames: profile?.campaignCharacterNames || existingLocal?.campaignCharacterNames || { [activeCampaign.id]: "" },
          lockedColorCampaignIds: profile?.lockedColorCampaignIds || existingLocal?.lockedColorCampaignIds || [],
          color: profile?.color || existingLocal?.color || COLORS[players.length % COLORS.length],
          campaignTokenImages: profile?.campaignTokenImages || existingLocal?.campaignTokenImages || {}
        };
        player = await mergeUserProfilesByEmail(uid, cleanEmail, player);
      }

      setPlayers((current) => {
        const withoutDuplicate = current.filter((item) => item.id !== uid && normalizeEmail(item.email) !== cleanEmail);
        return [...withoutDuplicate, player];
      });

      setCurrentUserId(uid);
      setActiveCampaignId(player.campaignIds?.[0] || activeCampaign.id);
      setAccountUsername(player.username || "");
      setAccountName(player.name || "");
      setAccountEmail(player.email || "");
      setAccountPhone(player.phone || "");
      setAccountPassword("");
      setScreen("dashboard");
      showMessage(authMode === "register" ? "Account created." : "Logged in.");
    } catch (error) {
      showMessage(authErrorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function logOut() {
    try {
      await signOut(firebaseAuth);
    } catch (error) {
      console.error("Firebase sign out failed:", error);
    }

    setCurrentUserId("");
    setScreen("login");

    if (!rememberMe) {
      setPassword("");
      setEmail("");
      safeWriteStorage("dungeon-calendar-mobile-state", {
        players,
        campaigns,
        plan,
        activeCampaignId,
        rememberMe: false,
        currentUserId: "",
        savedEmail: "",
        savedPassword: "",
        savedProfile: null
      });
    }
  }

  async function deleteCurrentAccount() {
    if (!currentUser || !currentUserId) return;

    if (visibleCampaigns.some((campaign) => campaign.dungeonMasterIds?.includes(currentUserId))) {
      showMessage("Accounts that are Dungeon Master for a campaign cannot be deleted until that role is removed.");
      return;
    }

    if (deleteConfirmText !== "DELETE") {
      showMessage("Type DELETE to confirm account removal.");
      return;
    }

    try {
      await deleteDoc(doc(firebaseDb, "users", currentUserId));
      if (firebaseAuth.currentUser?.uid === currentUserId) {
        await deleteUser(firebaseAuth.currentUser);
      }
    } catch (error) {
      console.error("Mobile account deletion failed:", error);
      if (error?.code === "auth/requires-recent-login") {
        showMessage("Log out, log back in, then delete the account again for security.");
        return;
      }
      showMessage(error?.message || "Could not delete account.");
      return;
    }

    setPlayers((current) => current.filter((player) => player.id !== currentUserId));
    setCurrentUserId("");
    setShowDeleteConfirm(false);
    setDeleteConfirmText("");
    setScreen("login");
    safeWriteStorage("dungeon-calendar-mobile-state", {
      players: [],
      campaigns: [],
      plan: "free",
      activeCampaignId: "",
      rememberMe: false,
      currentUserId: "",
      savedEmail: "",
      savedPassword: "",
      savedProfile: null
    });
    showMessage("Account deleted.");
  }

  function addCampaign() {
    if (!currentUser) return;

    const limit = PLANS[plan].campaigns;
    const ownedCampaignCount = campaigns.filter((campaign) => normalizeCampaign(campaign).ownerId === currentUser.id || normalizeCampaign(campaign).dungeonMasterIds.includes(currentUser.id)).length;
    if (limit !== Infinity && ownedCampaignCount >= limit) {
      setScreen("plans");
      showMessage("Upgrade your plan to create more campaigns. Invited campaigns are included.");
      return;
    }

    const campaign = makeCampaign(newCampaignName.trim() || `Campaign ${campaigns.length + 1}`, [currentUser.id], currentUser.id);
    setCampaigns((current) => [...current, campaign]);
    setPlayers((current) => current.map((player) => (player.id === currentUser.id ? {
      ...player,
      campaignIds: [...new Set([...(player.campaignIds || []), campaign.id])]
    } : player)));
    setNewCampaignName("");
    setActiveCampaignId(campaign.id);
    saveCampaignToFirestore(campaign);
    setScreen("calendar");
  }

  function joinCampaign(campaignId) {
    if (!currentUser || !campaignId) return;

    setPlayers((current) => current.map((player) => (player.id === currentUser.id ? {
      ...player,
      campaignIds: [...new Set([...(player.campaignIds || []), campaignId])]
    } : player)));
    setCampaigns((current) => current.map((campaign) => {
      if (campaign.id !== campaignId) return campaign;
      const normalized = normalizeCampaign(campaign);
      const nextCampaign = {
        ...normalized,
        memberIds: [...new Set([...(normalized.memberIds || []), currentUser.id])],
        leftUserIds: (normalized.leftUserIds || []).filter((id) => id !== currentUser.id)
      };
      saveCampaignToFirestore(nextCampaign);
      return nextCampaign;
    }));
    setActiveCampaignId(campaignId);
  }

  function leaveCampaign(campaignId) {
    if (!currentUser || !campaignId) return;
    setPlayers((current) => current.map((player) => (player.id === currentUser.id ? {
      ...player,
      campaignIds: (player.campaignIds || []).filter((id) => id !== campaignId)
    } : player)));
    setCampaigns((current) => current.map((campaign) => {
      if (campaign.id !== campaignId) return campaign;
      const normalized = normalizeCampaign(campaign);
      const nextCampaign = {
        ...normalized,
        memberIds: (normalized.memberIds || []).filter((id) => id !== currentUser.id),
        dungeonMasterIds: (normalized.dungeonMasterIds || []).filter((id) => id !== currentUser.id),
        leftUserIds: [...new Set([...(normalized.leftUserIds || []), currentUser.id])]
      };
      saveCampaignToFirestore(nextCampaign);
      return nextCampaign;
    }));
    const remaining = visibleCampaigns.filter((campaign) => campaign.id !== campaignId);
    setActiveCampaignId(remaining[0]?.id || "");
    showMessage("Campaign removed from your mobile app.");
  }

  function claimDungeonMasterRole() {
    if (!currentUser || !activeCampaign) return;

    setCampaigns((current) => current.map((campaign) => {
      if (campaign.id !== activeCampaign.id) return campaign;
      const nextCampaign = normalizeCampaign({
        ...campaign,
        ownerId: campaign.ownerId || currentUser.id,
        dungeonMasterIds: [...new Set([...(campaign.dungeonMasterIds || []), currentUser.id])],
        memberIds: [...new Set([...(campaign.memberIds || []), currentUser.id])]
      });
      saveCampaignToFirestore(nextCampaign);
      return nextCampaign;
    }));
    updateCurrentPlayer({ color: "#dc2626" });
    showMessage("You are now Dungeon Master for this campaign.");
  }

  function toggleDate(key) {
    if (!currentUser || !activeCampaign) return;

    const dmAvailable = (activeCampaign.availability[key] || []).some((id) => activeCampaign.dungeonMasterIds.includes(id));
    if (!isDungeonMaster && !dmAvailable) {
      showMessage("Players can only select dates marked available by the Dungeon Master.");
      return;
    }

    setCampaigns((current) => current.map((campaign) => {
      if (campaign.id !== activeCampaign.id) return campaign;

      const userId = currentUser.id;
      const available = campaign.availability?.[key] || [];
      const unavailable = campaign.unavailable?.[key] || [];
      let nextCampaign;

      if (isDungeonMaster || availabilityMode === "available") {
        nextCampaign = normalizeCampaign({
          ...campaign,
          availability: {
            ...(campaign.availability || {}),
            [key]: available.includes(userId) ? available.filter((id) => id !== userId) : [...available, userId]
          },
          unavailable: {
            ...(campaign.unavailable || {}),
            [key]: unavailable.filter((id) => id !== userId)
          }
        });
      } else {
        nextCampaign = normalizeCampaign({
          ...campaign,
          availability: {
            ...(campaign.availability || {}),
            [key]: available.filter((id) => id !== userId)
          },
          unavailable: {
            ...(campaign.unavailable || {}),
            [key]: unavailable.includes(userId) ? unavailable.filter((id) => id !== userId) : [...unavailable, userId]
          }
        });
      }

      saveCampaignToFirestore(nextCampaign);
      return nextCampaign;
    }));
  }

  function chooseFinalDate(key) {
    if (!isDungeonMaster) return;
    setCampaigns((current) => current.map((campaign) => {
      if (campaign.id !== activeCampaign.id) return campaign;
      const nextCampaign = normalizeCampaign({ ...campaign, chosenDate: key });
      saveCampaignToFirestore(nextCampaign);
      return nextCampaign;
    }));
    showMessage("Final session date selected.");
  }

  function autoPickDate() {
    if (!isDungeonMaster) return;

    if (plan === "free") {
      setScreen("plans");
      showMessage("Auto Pick is available with Adventurer and Guildmaster.");
      return;
    }

    const best = autoPickBestDate(activeCampaign);
    if (!best) {
      showMessage("No eligible dates yet. Mark Dungeon Master availability first.");
      return;
    }

    chooseFinalDate(best);
  }

  async function saveAccountSettings() {
    if (!accountUsername.trim() || !accountName.trim() || !accountEmail.trim()) {
      showMessage("Username, name, and email are required.");
      return;
    }

    const updatedProfile = {
      username: accountUsername.trim(),
      name: accountName.trim(),
      email: accountEmail.trim().toLowerCase(),
      phone: accountPhone.trim(),
      password: ""
    };

    updateCurrentPlayer(updatedProfile);

    if (rememberMe) {
      setEmail(updatedProfile.email);
      setPassword(updatedProfile.password);
    }

    try {
      await saveUserProfileToFirestore(currentUserId, {
        ...updatedProfile,
        campaignIds: currentUser.campaignIds || [],
        campaignCharacterNames: currentUser.campaignCharacterNames || {},
        color: currentUser.color || "",
        lockedColorCampaignIds: currentUser.lockedColorCampaignIds || [],
        campaignTokenImages: currentUser.campaignTokenImages || {}
      });
    } catch (error) {
      showMessage("Saved locally, but cloud sync failed. Check Firebase rules.");
      return;
    }

    safeWriteStorage("dungeon-calendar-mobile-profile", updatedProfile);
    showMessage("Account settings saved and synced.");
  }

  function updateCharacterName(campaignId, value) {
    const otherCharacters = Object.entries(currentUser?.campaignCharacterNames || {}).filter(([id, character]) => id !== campaignId && character).length;

    if (plan === "free" && value && otherCharacters >= 1) {
      setScreen("plans");
      showMessage("Upgrade your plan for more characters.");
      return;
    }

    updateCurrentPlayer({
      campaignCharacterNames: {
        ...(currentUser.campaignCharacterNames || {}),
        [campaignId]: value
      }
    });
  }

  function chooseColor(color) {
    if (!currentUser || isDungeonMaster) return;
    if ((currentUser.lockedColorCampaignIds || []).includes(activeCampaign.id)) return;

    const alreadyUsed = players.some((player) => player.id !== currentUser.id && player.color === color && player.campaignIds?.includes(activeCampaign.id));
    if (alreadyUsed) return;

    updateCurrentPlayer({
      color,
      lockedColorCampaignIds: [...new Set([...(currentUser.lockedColorCampaignIds || []), activeCampaign.id])]
    });
  }

  function invitePlayer() {
    if (!isDungeonMaster || !inviteName.trim()) return;

    const player = {
      id: makeId("player"),
      name: inviteName.trim(),
      username: inviteName.trim().toLowerCase().replace(/\s+/g, ""),
      email: normalizeEmail(inviteEmail),
      phone: invitePhone.trim(),
      password: "dungeon",
      invitePending: true,
      campaignIds: [activeCampaign.id],
      campaignCharacterNames: { [activeCampaign.id]: "" },
      color: COLORS[players.length % COLORS.length],
      lockedColorCampaignIds: [],
      campaignTokenImages: {}
    };

    setPlayers((current) => [...current, player]);
    setInviteName("");
    setInviteEmail("");
    setInvitePhone("");
    showMessage("Player invited. Default password: dungeon");
  }

  async function uploadToken(playerId, file) {
    if (plan !== "guildmaster") {
      setScreen("plans");
      showMessage("Token uploads are included with Guildmaster.");
      return;
    }

    const canEditToken = isDungeonMaster || playerId === currentUserId;
    if (!canEditToken) {
      showMessage("You can only add tokens to your own characters unless you are the Dungeon Master.");
      return;
    }

    if (!file || !activeCampaign?.id) return;

    if (!file.type?.startsWith("image/")) {
      showMessage("Please upload an image file for the token.");
      return;
    }

    if (file.size > TOKEN_IMAGE_MAX_BYTES) {
      showMessage("Token images must be 2 MB or smaller.");
      return;
    }

    try {
      const safeName = sanitizeTokenFileName(file.name);
      const tokenRef = ref(firebaseStorage, `token-images/${activeCampaign.id}/${playerId}-${Date.now()}-${safeName}`);
      await uploadBytes(tokenRef, file, { contentType: file.type || "image/jpeg" });
      const downloadUrl = await getDownloadURL(tokenRef);

      setPlayers((current) => current.map((player) => (player.id === playerId ? {
        ...player,
        campaignTokenImages: {
          ...(player.campaignTokenImages || {}),
          [activeCampaign.id]: downloadUrl
        }
      } : player)));
      showMessage("Token image uploaded.");
    } catch (error) {
      console.error("Token image upload failed:", error);
      if (error?.code === "storage/unauthorized") {
        showMessage("Token image upload failed because Firebase Storage rules denied access. Deploy the included storage.rules file, then try again.");
      } else {
        showMessage("Token image upload failed. Please try again.");
      }
    }
  }

  function removeToken(playerId) {
    const canEditToken = isDungeonMaster || playerId === currentUserId;
    if (!canEditToken) {
      showMessage("You can only remove tokens from your own characters unless you are the Dungeon Master.");
      return;
    }

    setPlayers((current) => current.map((player) => {
      if (player.id !== playerId) return player;
      const images = { ...(player.campaignTokenImages || {}) };
      delete images[activeCampaign.id];
      return { ...player, campaignTokenImages: images };
    }));
  }

  function completeCheckout(targetPlan) {
    if (targetPlan === "free") {
      setPlan("free");
      setSelectedCheckoutPlan("");
      if (currentUserId) {
        saveUserProfileToFirestore(currentUserId, {
          plan: "free",
          billingInterval: "monthly",
          updatedAt: new Date().toISOString()
        }).catch((error) => console.warn("Free plan sync failed:", error));
      }
      showMessage("Free plan is now active.");
      return;
    }

    setSelectedCheckoutPlan(targetPlan);
    setSelectedBillingInterval("monthly");
  }

  async function finishPayment() {
    if (!selectedCheckoutPlan || checkoutBusy) return;

    const firebaseUser = firebaseAuth.currentUser;
    const userId = currentUserId || firebaseUser?.uid || currentUser?.id || "";
    const userEmail = normalizeEmail(firebaseUser?.email || currentUser?.email || accountEmail || email);

    if (!userId || !userEmail) {
      showMessage("Log in before starting Stripe Checkout.");
      return;
    }

    const billingInterval = selectedBillingInterval || "monthly";
    setCheckoutBusy(true);

    try {
      await saveUserProfileToFirestore(userId, {
        pendingStripePlan: selectedCheckoutPlan,
        pendingStripeBillingInterval: billingInterval,
        pendingStripeStartedAt: new Date().toISOString()
      });

      const response = await fetch(`${STRIPE_API_BASE_URL}/api/create-checkout-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          email: userEmail,
          name: currentUser?.name || accountName || name || "",
          planId: selectedCheckoutPlan,
          billingInterval,
          returnUrl: window.location.origin
        })
      });

      let payload = null;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        payload = await response.json();
      } else {
        const text = await response.text();
        throw new Error(text || "Stripe Checkout API did not return JSON.");
      }

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || "Stripe Checkout did not return a checkout URL.");
      }

      window.location.assign(payload.url);
    } catch (error) {
      console.error("Mobile Stripe checkout failed:", error);
      showMessage(error?.message || "Could not start Stripe Checkout.");
      setCheckoutBusy(false);
    }
  }

  function Token({ player, large = false }) {
    const image = getTokenImageSrc(player?.campaignTokenImages?.[activeCampaign.id]);

    if (image) {
      return <img src={image} alt="token" style={large ? styles.tokenLargeImage : styles.tokenImage} />;
    }

    const isDm = activeCampaign.dungeonMasterIds.includes(player?.id);
    return <span style={{ ...(large ? styles.tokenLarge : styles.token), backgroundColor: isDm ? "#dc2626" : player?.color }} />;
  }

  function MiniStat({ label, value }) {
    return <section style={styles.stat}><p style={styles.smallText}>{label}</p><p style={styles.bigText}>{value}</p></section>;
  }

  function PlayerBadge({ player }) {
    return (
      <div style={styles.playerBadge}>
        <Token player={player} large />
        <span style={styles.badgeName}>
          <span style={{ ...styles.dot, backgroundColor: activeCampaign.dungeonMasterIds.includes(player.id) ? "#dc2626" : player.color }} />
          {firstName(player.campaignCharacterNames?.[activeCampaign.id] || player.name)}
        </span>
      </div>
    );
  }

  function MenuDropdown() {
    const items = [
      ["dashboard", "Dashboard"],
      ["calendar", "Calendar"],
      ["players", "Players"],
      ...(isDungeonMaster ? [["results", "Results"]] : []),
      ["plans", "Plan Options"],
      ...(isDungeonMaster ? [["settings", "Campaign Settings"]] : []),
      ["account", "User Settings"]
    ];

    return (
      <div style={styles.menuWrap}>
        <button type="button" style={styles.menuButton} onClick={() => setMenuOpen((open) => !open)}>
          ☰ Menu
        </button>
        {menuOpen && (
          <div style={styles.menuPanel}>
            {items.map(([id, label]) => (
              <button
                key={id}
                type="button"
                style={{ ...styles.menuItem, ...(screen === id ? styles.menuItemActive : {}) }}
                onClick={() => {
                  setScreen(id);
                  setMenuOpen(false);
                }}
              >
                {label}
              </button>
            ))}

            <div style={styles.menuDivider} />

            <button
              type="button"
              style={{ ...styles.menuItem, ...styles.logoutMenuItem }}
              onClick={() => {
                setMenuOpen(false);
                logOut();
              }}
            >
              Log Out
            </button>
          </div>
        )}
      </div>
    );
  }

  function BackButton() {
    if (screen === "dashboard") return null;

    return (
      <button
        type="button"
        style={styles.backButton}
        onClick={() => setScreen("dashboard")}
      >
        ← Back
      </button>
    );
  }

  function Header() {
    return (
      <header style={styles.appHeader}>
        <BackButton />
        <img src={logoUrl} alt="Dungeon Calendar" style={styles.headerLogo} />
        <div style={styles.headerTextBlock}>
          <strong style={styles.headerTitle}>Dungeon Calendar</strong>
          <span style={styles.headerSubTitle}>{activeCampaign?.name || "Campaign Scheduler"}</span>
        </div>
        <MenuDropdown />
      </header>
    );
  }

  function shellRenderer(children) {
    return (
      <main style={styles.screenTop}>
        <section style={styles.phoneFrameWide}>
          <Header />
          <div style={styles.contentArea}>
            {message && <p style={styles.message}>{message}</p>}
            <div style={styles.page}>{children}</div>
          </div>
        </section>
      </main>
    );
  }

  function LoginScreen() {
    return (
      <main style={styles.screenCenter}>
        <section style={styles.phoneFrame}>
          <img src={logoUrl} alt="Dungeon Calendar" style={styles.logo} />
          <h1 style={styles.title}>{authMode === "login" ? "Welcome Back" : "Create Account"}</h1>
          <p style={styles.subtitle}>Mobile campaign scheduling, voting, player management, plans, and session exports.</p>

          <div style={styles.toggleRow}>
            <button type="button" style={{ ...styles.toggleButton, ...(authMode === "login" ? styles.activeButton : {}) }} onClick={() => setAuthMode("login")}>Log In</button>
            <button type="button" style={{ ...styles.toggleButton, ...(authMode === "register" ? styles.activeButton : {}) }} onClick={() => setAuthMode("register")}>Register</button>
          </div>

          {authMode === "register" && <input style={styles.input} value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />}
          <input style={styles.input} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" />
          <input style={styles.input} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />

          <label style={styles.checkRow}>
            <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /> Remember Me
          </label>
          <button type="button" style={styles.primaryButton} disabled={authBusy} onClick={signIn}>{authBusy ? "Working..." : authMode === "login" ? "Log In" : "Create Account"}</button>
          <button type="button" style={styles.googleButton} disabled={authBusy} onClick={signInWithGoogle}>{authBusy ? "Working..." : "Continue with Google"}</button>
          {message && <p style={styles.message}>{message}</p>}
        </section>
      </main>
    );
  }

  function DashboardScreen() {
    if (!activeCampaign) {
      return shellRenderer(<><section style={styles.heroCard}><p style={styles.kicker}>Welcome back</p><h1 style={styles.heading}>{currentUser?.username || firstName(currentUser?.name)}!</h1><p style={styles.subtitle}>No active campaigns found for this account.</p></section>{CampaignSelector()}</>);
    }
    const availablePlayers = selectedDateAvailability.map((id) => players.find((p) => p.id === id)).filter(Boolean);
    const unavailablePlayers = selectedDateUnavailable.map((id) => players.find((p) => p.id === id)).filter(Boolean);
    const recentDates = Array.from(
      new Set([
        ...Object.keys(activeCampaign?.availability || {}),
        ...Object.keys(activeCampaign?.unavailable || {})
      ])
    ).sort().slice(0, 4);
    const summary = dashboardSummary({ activeCampaignPlayers, selectedDateAvailability, selectedDateUnavailable, plan, isDungeonMaster });
    const campaignCount = currentUser?.campaignIds?.length || 0;
    const characterCount = Object.values(currentUser?.campaignCharacterNames || {}).filter(Boolean).length;

    return shellRenderer(
      <>
        <section style={styles.heroCard}>
          <p style={styles.kicker}>Welcome back</p>
          <h1 style={styles.heading}>{currentUser?.username || firstName(currentUser?.name)}!</h1>
          <p style={styles.subtitle}>{activeCampaign?.name || "Dungeon Calendar"}</p>
          <div style={styles.heroMetaGrid}>
            <span style={styles.heroMeta}>Role: {summary.role}</span>
            <span style={styles.heroMeta}>Campaigns: {campaignCount}/{planLimitText(PLANS[plan].campaigns)}</span>
            <span style={styles.heroMeta}>Characters: {characterCount}/{planLimitText(PLANS[plan].characters)}</span>
          </div>
        </section>

        

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Upcoming Session</h2>
          <p style={styles.bigText}>{activeCampaign?.chosenDate ? dateLabel(activeCampaign.chosenDate) : "No final date selected"}</p>
          <p style={styles.smallText}>Time: {activeCampaign.sessionTime || "18:00"} • Duration: {activeCampaign.sessionDuration || 4} hours • Reminder: {activeCampaign.reminderHours || 24} hours before</p>
          {activeCampaign?.chosenDate && (
            <>
              <p style={styles.smallText}>Available: {availablePlayers.length}/{activeCampaignPlayers.length}</p>
              <div style={styles.tokenGrid}>{availablePlayers.map((player) => <PlayerBadge key={player.id} player={player} />)}</div>
              <p style={styles.smallText}>Not Available: {unavailablePlayers.length}/{activeCampaignPlayers.length}</p>
              <div style={styles.tokenGrid}>{unavailablePlayers.map((player) => <PlayerBadge key={player.id} player={player} />)}</div>
            </>
          )}
          {isDungeonMaster && <button type="button" style={styles.secondaryButton} onClick={autoPickDate}>Auto Pick Best Date</button>}
          {calendarLinks && plan !== "free" && (
            <div style={styles.grid2}>
              <a style={styles.linkButton} href={calendarLinks.google} target="_blank" rel="noreferrer">Google Calendar</a>
              <a style={styles.linkButton} href={calendarLinks.outlook} target="_blank" rel="noreferrer">Outlook</a>
            </div>
          )}
        </section>

        {CalendarOverview()}

        <section style={styles.card}>
          <div style={styles.sectionHeader}>
            <h2 style={styles.cardTitle}>Party Overview</h2>
            <button type="button" style={styles.miniButton} onClick={() => setScreen("players")}>Players</button>
          </div>
          <div style={styles.tokenGrid}>{activeCampaignPlayers.map((player) => <PlayerBadge key={player.id} player={player} />)}</div>
        </section>

        

        <section style={styles.card}>
          <div style={styles.sectionHeader}>
            <h2 style={styles.cardTitle}>Quick Actions</h2>
          </div>
          <div style={styles.quickGrid}>
            <button type="button" style={styles.quickButton} onClick={() => setScreen("campaigns")}>Choose Campaign</button>
            <button type="button" style={styles.quickButton} onClick={() => setScreen("calendar")}>Propose New Dates</button>
            <button type="button" style={styles.quickButton} onClick={() => setScreen("players")}>Manage Players</button>
            {isDungeonMaster && (
              <button type="button" style={styles.quickButton} onClick={() => setScreen("results")}>View All Results</button>
            )}
            {isDungeonMaster && (
              <button type="button" style={styles.quickButton} onClick={() => setScreen("settings")}>Campaign Settings</button>
            )}
          </div>
        </section>

        <div style={styles.grid2}>
          <MiniStat label="Players" value={summary.players} />
          <MiniStat
            label="Dates"
            value={Array.from(
              new Set([
                ...Object.keys(activeCampaign?.availability || {}),
                ...Object.keys(activeCampaign?.unavailable || {})
              ])
            ).filter((key) => {
              const available = activeCampaign?.availability?.[key] || [];
              return available.some((id) => activeCampaign?.dungeonMasterIds?.includes(id));
            }).length}
          />
          <MiniStat label="Role" value={isDungeonMaster ? "DM" : "Player"} />
        </div>
      </>
    );
  }

  function DateScoreBadge({ dateKeyValue }) {
    const result = getDateScore(activeCampaign, dateKeyValue);
    const rankLabel = getDateRankLabel(activeCampaign, dateKeyValue);
    const isBest = rankLabel === "Best Date";

    if (!result.totalResponses && !result.dmAvailable && !result.dmUnavailable) return null;

    return (
      <span style={{ ...styles.scoreBadge, ...(isBest ? styles.bestScoreBadge : {}) }}>
        {isBest ? "Best" : rankLabel === "Second Best" ? "2nd" : rankLabel === "Worst Date" ? "Worst" : `${result.availableCount}/${activeCampaignPlayers.length}`}
      </span>
    );
  }

  function DateOptionDetails({ dateKeyValue }) {
    const result = getDateScore(activeCampaign, dateKeyValue);
    const rankLabel = getDateRankLabel(activeCampaign, dateKeyValue);
    const isBest = rankLabel === "Best Date";

    return (
      <div style={styles.dateOptionDetails}>
        <span style={isBest ? styles.bestDateText : styles.rankLabelText}>{rankLabel}</span>
        <span>Available: {result.availableCount}/{activeCampaignPlayers.length}</span>
        <span>Not Available: {result.unavailableCount}</span>
        <span>Score: {result.dmAvailable ? result.score : "Waiting for DM"}</span>
      </div>
    );
  }

  function CalendarOverview() {
    if (!activeCampaign) return null;
    return (
      <section style={styles.card}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.cardTitle}>{monthLabel(viewDate)} Overview</h2>
          <button type="button" style={styles.miniButton} onClick={() => setScreen("calendar")}>Open Calendar</button>
        </div>
        <div style={styles.overviewWeekdays}>
          {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
        </div>
        <div style={styles.overviewGrid}>
          {calendarMonthDays.map((date) => {
            const key = dateKey(date);
            const available = activeCampaign.availability[key] || [];
            const unavailable = activeCampaign.unavailable[key] || [];
            const dmAvailable = available.some((id) => activeCampaign.dungeonMasterIds.includes(id));
            const dmUnavailable = unavailable.some((id) => activeCampaign.dungeonMasterIds.includes(id));
            const final = activeCampaign.chosenDate === key;
            const outsideMonth = date.getMonth() !== viewDate.getMonth();
            return (
              <span
                key={key}
                title={key}
                style={{
                  ...styles.overviewDay,
                  ...(outsideMonth ? styles.overviewOutsideDay : {}),
                  ...(dmAvailable ? styles.dmAvailable : {}),
                  ...(dmUnavailable ? styles.dmUnavailable : {}),
                  ...(final ? styles.finalDate : {})
                }}
              >
                
              </span>
            );
          })}
        </div>
      </section>
    );
  }

  function CampaignSelector() {
    return (
      <section style={styles.cardCompact}>
        <label style={styles.label}>Campaign</label>
        {visibleCampaigns.length ? (
          <select style={styles.input} value={activeCampaign?.id || ""} onChange={(event) => setActiveCampaignId(event.target.value)}>
            {visibleCampaigns.map((campaign, index) => <option key={campaign.id} value={campaign.id}>{campaign.name || `Campaign ${index + 1}`}</option>)}
          </select>
        ) : <p style={styles.smallText}>No active campaigns found for this account.</p>}
        <input style={styles.input} value={newCampaignName} onChange={(event) => setNewCampaignName(event.target.value)} placeholder="New campaign name" />
        <button type="button" style={styles.primaryButton} onClick={addCampaign}>Add Campaign</button>
      </section>
    );
  }

  function CalendarScreen() {
    if (!activeCampaign) {
      return shellRenderer(<><h1 style={styles.heading}>Calendar</h1><p style={styles.subtitle}>No active campaigns found. Create or join a campaign to mark dates.</p>{CampaignSelector()}</>);
    }
    return shellRenderer(
      <>
        <h1 style={styles.heading}>Calendar</h1>
        {CampaignSelector()}
        {!isDungeonMaster && (
          <div style={styles.toggleRow}>
            <button type="button" style={{ ...styles.toggleButton, ...(availabilityMode === "available" ? styles.availableButton : {}) }} onClick={() => setAvailabilityMode("available")}>Available</button>
            <button type="button" style={{ ...styles.toggleButton, ...(availabilityMode === "unavailable" ? styles.unavailableButton : {}) }} onClick={() => setAvailabilityMode("unavailable")}>Not Available</button>
          </div>
        )}

        <section style={styles.card}>
          <div style={styles.calendarHeader}>
            <button type="button" style={styles.monthButton} onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}>‹</button>
            <h2 style={styles.cardTitle}>{monthLabel(viewDate)}</h2>
            <button type="button" style={styles.monthButton} onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}>›</button>
          </div>

          <div style={styles.weekdayGrid}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}
          </div>

          <div style={styles.monthGrid}>
            {calendarMonthDays.map((date) => {
              const key = dateKey(date);
              const available = activeCampaign.availability[key] || [];
              const unavailable = activeCampaign.unavailable[key] || [];
              const dmAvailable = available.some((id) => activeCampaign.dungeonMasterIds.includes(id));
              const dmUnavailable = unavailable.some((id) => activeCampaign.dungeonMasterIds.includes(id));
              const selected = available.includes(currentUser?.id) || unavailable.includes(currentUser?.id);
              const final = activeCampaign.chosenDate === key;
              const outsideMonth = date.getMonth() !== viewDate.getMonth();

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleDate(key)}
                  style={{
                    ...styles.monthDay,
                    ...(outsideMonth ? styles.outsideMonthDay : {}),
                    ...(dmAvailable ? styles.dmAvailable : {}),
                    ...(dmUnavailable ? styles.dmUnavailable : {}),
                    ...(selected ? styles.selectedDate : {}),
                    ...(final ? styles.finalDate : {})
                  }}
                >
                  <strong>{date.getDate()}</strong>
                  <small style={styles.calendarSmallText}>{dmAvailable ? "DM" : dmUnavailable ? "No" : ""}</small>
                  
                  {isDungeonMaster && dmAvailable && <span onClick={(event) => { event.stopPropagation(); chooseFinalDate(key); }} style={styles.finalPill}>Final</span>}
                </button>
              );
            })}
          </div>
        </section>
      </>
    );
  }

  function PlayersScreen() {
    return shellRenderer(
      <>
        <h1 style={styles.heading}>Players</h1>
        {CampaignSelector()}
        {isDungeonMaster && (
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Invite Players</h2>
            <input style={styles.input} value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder="Player name" />
            <input style={styles.input} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="Email optional" />
            <input style={styles.input} value={invitePhone} onChange={(event) => setInvitePhone(event.target.value)} placeholder="Phone optional" />
            <button type="button" style={styles.primaryButton} onClick={invitePlayer}>Add Invite</button>
          </section>
        )}
        {activeCampaignPlayers.map((player) => {
          const isDm = activeCampaign.dungeonMasterIds.includes(player.id);
          const displayName = player.campaignCharacterNames?.[activeCampaign.id] || player.name;
          return (
            <div key={player.id} style={styles.playerRow}>
              <Token player={player} />
              <div style={{ flex: 1 }}>
                <h2 style={styles.cardTitle}>{displayName}</h2>
                <p style={styles.smallText}>{isDm ? "Dungeon Master" : `Player: ${player.name}`}</p>
                {plan === "guildmaster" && (isDungeonMaster || player.id === currentUserId) && (
                  <div style={styles.rowWrap}>
                    <label style={styles.fileButton}>Upload Token<input type="file" accept="image/*" style={{ display: "none" }} onChange={(event) => uploadToken(player.id, event.target.files?.[0])} /></label>
                    {player.campaignTokenImages?.[activeCampaign.id] && <button type="button" style={styles.dangerButton} onClick={() => removeToken(player.id)}>Remove Token</button>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </>
    );
  }

  function ResultsScreen() {
    const resultDates = Array.from(
      new Set([
        ...Object.keys(activeCampaign?.availability || {}),
        ...Object.keys(activeCampaign?.unavailable || {})
      ])
    )
      .filter((key) => {
        const available = activeCampaign?.availability?.[key] || [];
        return available.some((id) => activeCampaign?.dungeonMasterIds?.includes(id));
      })
      .sort();

    return shellRenderer(
      <>
        <h1 style={styles.heading}>Results</h1>
        {isDungeonMaster && plan !== "free" && <button type="button" style={styles.primaryButton} onClick={autoPickDate}>Auto Pick Best Date</button>}
        {resultDates.length === 0 && <section style={styles.card}><p style={styles.smallText}>No availability marked yet.</p></section>}
        {resultDates.map((key) => {
          const available = activeCampaign.availability[key] || [];
          const unavailable = activeCampaign.unavailable[key] || [];
          const rankLabel = getDateRankLabel(activeCampaign, key);
          const isBest = rankLabel === "Best Date";

          return (
            <section key={key} style={{ ...styles.card, ...(isBest ? styles.bestResultCard : {}) }}>
              <div style={styles.sectionHeader}>
                <h2 style={styles.cardTitle}>{dateLabel(key)}</h2>
                <span style={isBest ? styles.bestDateText : styles.rankLabelText}>{rankLabel}</span>
              </div>
              <p style={styles.smallText}>Available: {available.length}/{activeCampaignPlayers.length}</p>
              <p style={styles.smallText}>Not Available: {unavailable.length}</p>
              {plan === "guildmaster" && <p style={styles.smallText}>Full tracking: {available.map((id) => firstName(players.find((p) => p.id === id)?.name)).join(", ") || "None"}</p>}
              {isDungeonMaster && available.length > 0 && <button type="button" style={styles.secondaryButton} onClick={() => chooseFinalDate(key)}>Choose Final Date</button>}
            </section>
          );
        })}
      </>
    );
  }

  function PlansScreen() {
    return shellRenderer(
      <>
        <h1 style={styles.heading}>Plans</h1>
        {Object.entries(PLANS).map(([id, item]) => (
          <section key={id} style={{ ...styles.card, ...(plan === id ? styles.activePlan : {}) }}>
            <h2 style={styles.cardTitle}>{item.name}</h2>
            <p style={styles.bigText}>{item.price}</p>
            <p style={styles.smallText}>{planLimitText(item.campaigns)} campaigns • {planLimitText(item.characters)} characters</p>
            <ul style={styles.featureList}>{item.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            <button type="button" style={styles.primaryButton} disabled={plan === id} onClick={() => completeCheckout(id)}>{planActionLabel(plan, id)}</button>
          </section>
        ))}
        {selectedCheckoutPlan && (
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Checkout: {PLANS[selectedCheckoutPlan].name}</h2>
            <p style={styles.smallText}>Choose your billing interval before continuing to Stripe Checkout. Your plan will update after Stripe confirms payment.</p>

            <div style={styles.toggleRow}>
              <button
                type="button"
                style={{ ...styles.toggleButton, ...(selectedBillingInterval === "monthly" ? styles.activeButton : {}) }}
                disabled={checkoutBusy}
                onClick={() => setSelectedBillingInterval("monthly")}
              >
                Monthly
              </button>
              <button
                type="button"
                style={{ ...styles.toggleButton, ...(selectedBillingInterval === "yearly" ? styles.activeButton : {}) }}
                disabled={checkoutBusy}
                onClick={() => setSelectedBillingInterval("yearly")}
              >
                Yearly
              </button>
            </div>

            <p style={styles.smallText}>Selected billing: <strong>{selectedBillingInterval === "yearly" ? "Yearly" : "Monthly"}</strong></p>
            <button type="button" style={styles.primaryButton} disabled={checkoutBusy} onClick={finishPayment}>{checkoutBusy ? "Opening Stripe..." : `Continue to Stripe Checkout (${selectedBillingInterval === "yearly" ? "Yearly" : "Monthly"})`}</button>
            <button type="button" style={styles.secondaryButton} disabled={checkoutBusy} onClick={() => setSelectedCheckoutPlan("")}>Cancel</button>
          </section>
        )}
      </>
    );
  }

  function SettingsScreen() {
    if (!isDungeonMaster) {
      return DashboardScreen();
    }

    return shellRenderer(
      <>
        <h1 style={styles.heading}>Settings</h1>
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Campaign Settings</h2>
          <input style={styles.input} value={activeCampaign.name} onChange={(event) => setCampaigns((current) => current.map((campaign) => (campaign.id === activeCampaign.id ? { ...campaign, name: event.target.value } : campaign)))} placeholder="Campaign name" />
          <input style={styles.input} value={activeCampaign.sessionTime} onChange={(event) => setCampaigns((current) => current.map((campaign) => (campaign.id === activeCampaign.id ? { ...campaign, sessionTime: event.target.value } : campaign)))} type="time" />
          <input style={styles.input} value={activeCampaign.sessionDuration} onChange={(event) => setCampaigns((current) => current.map((campaign) => (campaign.id === activeCampaign.id ? { ...campaign, sessionDuration: event.target.value } : campaign)))} type="number" min="1" />
        </section>
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Campaign Role</h2>
          <p style={styles.smallText}>{isDungeonMaster ? "Dungeon Master" : "Player"}</p>
          {!isDungeonMaster && <button type="button" style={styles.secondaryButton} onClick={claimDungeonMasterRole}>Claim Dungeon Master Role</button>}
        </section>
        {!isDungeonMaster && !(currentUser?.lockedColorCampaignIds || []).includes(activeCampaign.id) && (
          <section style={styles.card}>
            <h2 style={styles.cardTitle}>Choose Player Color</h2>
            <div style={styles.rowWrap}>{COLORS.map((color) => <button type="button" key={color} style={{ ...styles.colorButton, backgroundColor: color }} onClick={() => chooseColor(color)} />)}</div>
          </section>
        )}
        <button type="button" style={styles.secondaryButton} onClick={logOut}>Log Out</button>
      </>
    );
  }

  function CampaignMembershipScreen() {
    const membershipCampaigns = visibleCampaigns;

    return shellRenderer(
      <>
        <h1 style={styles.heading}>Choose Campaign</h1>
        <p style={styles.subtitle}>Select which campaign you want to view or join.</p>

        <section style={styles.card}>
          {membershipCampaigns.map((campaign) => {
            const isActive = campaign.id === activeCampaign?.id;
            const isJoined = currentUser?.campaignIds?.includes(campaign.id) || campaign.dungeonMasterIds?.includes(currentUser?.id);
            const characterName = currentUser?.campaignCharacterNames?.[campaign.id] || "";

            return (
              <div key={campaign.id} style={{ ...styles.membershipRow, ...(isActive ? styles.activeMembershipRow : {}) }}>
                <strong>{campaign.name || "Unnamed Campaign"}</strong>
                <p style={styles.smallText}>{isActive ? "Currently viewing" : isJoined ? "Joined" : "Not joined yet"}</p>

                <input
                  style={styles.input}
                  value={characterName}
                  onChange={(event) => updateCharacterName(campaign.id, event.target.value)}
                  placeholder="Character name for this campaign"
                />

                <div style={styles.membershipActions}>
                  <button
                    type="button"
                    style={{ ...styles.secondaryButton, ...styles.membershipButton }}
                    onClick={() => joinCampaign(campaign.id)}
                  >
                    {isJoined ? "Select Campaign" : "Join Campaign"}
                  </button>

                  {isJoined && !campaign.dungeonMasterIds?.includes(currentUser?.id) && (
                    <button
                      type="button"
                      style={{ ...styles.dangerButton, ...styles.membershipDangerButton }}
                      onClick={() => leaveCampaign(campaign.id)}
                    >
                      Leave Campaign
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Add Campaign</h2>
          <input
            style={styles.input}
            value={newCampaignName}
            onChange={(event) => setNewCampaignName(event.target.value)}
            placeholder="New campaign name"
          />
          <button type="button" style={styles.primaryButton} onClick={addCampaign}>Add Campaign</button>
        </section>
      </>
    );
  }

  function AccountScreen() {
    const campaignCount = currentUser?.campaignIds?.length || 0;
    const characterCount = Object.values(currentUser?.campaignCharacterNames || {}).filter(Boolean).length;

    return shellRenderer(
      <>
        <h1 style={styles.heading}>User Settings</h1>
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Current Plan</h2>
          <p style={styles.bigText}>{PLANS[plan].name}</p>
          <p style={styles.smallText}>{campaignCount}/{planLimitText(PLANS[plan].campaigns)} campaigns • {characterCount}/{planLimitText(PLANS[plan].characters)} characters</p>
          <div style={styles.accountPlanActions}>
            <button type="button" style={{ ...styles.primaryButton, marginTop: 0 }} onClick={() => setScreen("plans")}>Change Plan</button>
            {plan !== "free" && (
              <button
                type="button"
                style={{ ...styles.dangerButton, ...styles.accountDangerButton }}
                onClick={() => setPlan("free")}
              >
                Cancel Membership
              </button>
            )}
          </div>
        </section>
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Profile & Login</h2>
          <input style={styles.input} value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} placeholder="Username" />
          <input style={styles.input} value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Full name" />
          <input style={styles.input} value={accountPhone} onChange={(event) => setAccountPhone(event.target.value)} placeholder="Phone" />
          <input style={styles.input} value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} placeholder="Email" />
          <input style={styles.input} value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} placeholder="Password" type="password" />
          <button type="button" style={styles.primaryButton} onClick={saveAccountSettings}>Save Changes</button>
        </section>
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Legal</h2>
          <p style={styles.smallText}>Review Dungeon Calendar's Privacy Policy and Terms of Service.</p>
          <button type="button" style={styles.secondaryButton} onClick={() => window.open("/privacy", "_blank", "noopener,noreferrer")}>Privacy Policy</button>
          <button type="button" style={styles.secondaryButton} onClick={() => window.open("/terms", "_blank", "noopener,noreferrer")}>Terms of Service</button>
        </section>
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Account Security</h2>
          <p style={styles.smallText}>Permanently delete this mobile account profile. Dungeon Masters must transfer or remove their DM role first.</p>
          {!showDeleteConfirm ? (
            <button type="button" style={styles.dangerButton} onClick={() => setShowDeleteConfirm(true)}>Delete Account</button>
          ) : (
            <div>
              <p style={styles.smallText}>Type DELETE to confirm.</p>
              <input style={styles.input} value={deleteConfirmText} onChange={(event) => setDeleteConfirmText(event.target.value)} placeholder="Type DELETE" />
              <button type="button" style={styles.dangerButton} onClick={deleteCurrentAccount}>Confirm Delete</button>
              <button type="button" style={styles.secondaryButton} onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(""); }}>Cancel</button>
            </div>
          )}
        </section>
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Campaign Memberships</h2>
          {visibleCampaigns.map((campaign) => (
            <div key={campaign.id} style={styles.membershipRow}>
              <strong>{campaign.name}</strong>
              <input style={styles.input} value={currentUser?.campaignCharacterNames?.[campaign.id] || ""} onChange={(event) => updateCharacterName(campaign.id, event.target.value)} placeholder="Character name" />
              <div style={styles.membershipActions}>
                <button
                  type="button"
                  style={{ ...styles.secondaryButton, ...styles.membershipButton }}
                  onClick={() => joinCampaign(campaign.id)}
                >
                  Join / Select
                </button>
                {currentUser?.campaignIds?.includes(campaign.id) && (
                  <button
                    type="button"
                    style={{ ...styles.dangerButton, ...styles.membershipDangerButton }}
                    onClick={() => leaveCampaign(campaign.id)}
                  >
                    Leave
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      </>
    );
  }

  if (!authReady) return <main style={styles.screenCenter}><section style={styles.phoneFrame}><p style={styles.subtitle}>Checking saved login...</p></section></main>;
  if (!currentUser) return LoginScreen();
  if (screen === "calendar") return CalendarScreen();
  if (screen === "players") return PlayersScreen();
  if (screen === "results") return isDungeonMaster ? ResultsScreen() : DashboardScreen();
  if (screen === "plans") return PlansScreen();
  if (screen === "settings") return isDungeonMaster ? SettingsScreen() : DashboardScreen();
  if (screen === "campaigns") return CampaignMembershipScreen();
  if (screen === "account") return AccountScreen();
  return DashboardScreen();
}

const styles = {
  screenCenter: { minHeight: "100vh", background: `linear-gradient(rgba(0,0,0,.62), rgba(0,0,0,.86)), url(${backgroundUrl}) center/cover fixed`, display: "flex", justifyContent: "center", alignItems: "center", padding: 16, color: "white", fontFamily: "Inter, system-ui, sans-serif" },
  screenTop: { minHeight: "100vh", background: `linear-gradient(rgba(0,0,0,.62), rgba(0,0,0,.9)), url(${backgroundUrl}) center/cover fixed`, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 16, color: "white", fontFamily: "Inter, system-ui, sans-serif" },
  phoneFrame: { width: "100%", maxWidth: 430, border: "1px solid #3f3f46", borderRadius: 28, padding: 20, background: "linear-gradient(180deg, rgba(0,0,0,.82), rgba(24,24,27,.72))", boxShadow: "0 30px 90px rgba(0,0,0,.6)" },
  phoneFrameWide: { width: "100%", maxWidth: 540, height: "calc(100vh - 32px)", border: "1px solid #3f3f46", borderRadius: 28, background: "linear-gradient(180deg, rgba(0,0,0,.82), rgba(24,24,27,.72))", boxShadow: "0 30px 90px rgba(0,0,0,.6)", overflow: "hidden", display: "flex", flexDirection: "column" },
  logo: { width: "100%", maxHeight: 170, objectFit: "contain", marginBottom: 8 },
  title: { fontSize: 30, fontWeight: 900, textAlign: "center", margin: "8px 0" },
  heading: { fontSize: 30, fontWeight: 900, margin: "0 0 4px" },
  subtitle: { color: "#d1d5db", margin: "0 0 16px" },
  page: { padding: 16, paddingBottom: 40 },
  contentArea: { flex: 1, overflowY: "auto" },
  appHeader: { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: "1px solid #27272a", background: "rgba(0,0,0,.35)" },
  headerLogo: { width: 58, height: 58, objectFit: "contain", flexShrink: 0 },
  headerTextBlock: { minWidth: 0, display: "flex", flexDirection: "column" },
  headerTitle: { color: "white", fontSize: 18, lineHeight: 1.1 },
  headerSubTitle: { color: "#a1a1aa", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  menuWrap: { position: "relative", marginLeft: "auto", flexShrink: 0 },
  backButton: { border: "1px solid #3f3f46", borderRadius: 999, padding: "9px 12px", background: "rgba(0,0,0,.45)", color: "white", fontWeight: 900, cursor: "pointer", flexShrink: 0 },
  menuButton: { border: "1px solid #7f1d1d", borderRadius: 999, padding: "10px 14px", background: "rgba(127,29,29,.72)", color: "white", fontWeight: 900, cursor: "pointer" },
  menuPanel: { position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 20, width: 230, border: "1px solid #3f3f46", borderRadius: 16, padding: 8, background: "rgba(0,0,0,.96)", boxShadow: "0 18px 40px rgba(0,0,0,.55)" },
  menuItem: { width: "100%", border: 0, borderRadius: 12, padding: "12px 14px", background: "transparent", color: "white", fontWeight: 800, cursor: "pointer", textAlign: "left" },
  menuItemActive: { background: "#7f1d1d" },
  menuDivider: { height: 1, background: "rgba(255,255,255,.08)", margin: "8px 4px" },
  logoutMenuItem: { color: "#fecaca", background: "rgba(127,29,29,.18)" },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #3f3f46", background: "rgba(0,0,0,.55)", color: "white", borderRadius: 14, padding: 14, marginBottom: 12 },
  googleButton: { width: "100%", border: "1px solid rgba(255,255,255,.22)", borderRadius: 14, padding: 14, marginTop: 10, background: "rgba(255,255,255,.08)", color: "white", fontWeight: 900, cursor: "pointer" },
  primaryButton: { width: "100%", border: 0, borderRadius: 14, padding: 14, marginTop: 12, background: "#b91c1c", color: "white", fontWeight: 900, cursor: "pointer" },
  secondaryButton: { width: "100%", border: "1px solid #7f1d1d", borderRadius: 14, padding: 12, marginTop: 12, background: "transparent", color: "white", fontWeight: 800, cursor: "pointer" },
  dangerButton: { border: "1px solid #991b1b", borderRadius: 12, padding: "10px 12px", background: "rgba(127,29,29,.28)", color: "#fecaca", fontWeight: 800, cursor: "pointer" },
  fileButton: { border: "1px solid #b45309", borderRadius: 12, padding: "10px 12px", color: "#fde68a", cursor: "pointer", fontWeight: 800 },
  checkRow: { display: "flex", gap: 8, alignItems: "center", color: "#e5e7eb", marginBottom: 8 },
  toggleRow: { display: "flex", gap: 8, marginBottom: 12 },
  toggleButton: { flex: 1, border: "1px solid #3f3f46", borderRadius: 12, padding: 12, background: "transparent", color: "white", fontWeight: 800, cursor: "pointer" },
  activeButton: { background: "#b91c1c" },
  availableButton: { background: "#047857" },
  unavailableButton: { background: "#b91c1c" },
  message: { border: "1px solid #f59e0b", background: "rgba(120,53,15,.35)", color: "#fde68a", borderRadius: 12, padding: 10, margin: "12px 16px" },
  card: { border: "1px solid #3f3f46", background: "rgba(0,0,0,.62)", backdropFilter: "blur(8px)", borderRadius: 18, padding: 16, marginBottom: 14 },
  heroCard: { border: "1px solid #7f1d1d", background: "linear-gradient(135deg, rgba(127,29,29,.55), rgba(0,0,0,.58))", borderRadius: 22, padding: 18, marginBottom: 14, boxShadow: "0 20px 60px rgba(127,29,29,.25)" },
  heroMetaGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 },
  heroMeta: { border: "1px solid rgba(255,255,255,.12)", borderRadius: 999, padding: "7px 9px", background: "rgba(0,0,0,.35)", color: "#e5e7eb", fontSize: 12, fontWeight: 800 },
  kicker: { margin: 0, color: "#fbbf24", textTransform: "uppercase", letterSpacing: 2, fontSize: 11, fontWeight: 900 },
  cardCompact: { border: "1px solid #3f3f46", background: "rgba(0,0,0,.45)", borderRadius: 18, padding: 12, marginBottom: 14 },
  cardTitle: { color: "white", fontSize: 18, fontWeight: 900, margin: 0 },
  bigText: { color: "white", fontSize: 24, fontWeight: 900, margin: "6px 0" },
  smallText: { color: "#a1a1aa", margin: "4px 0" },
  label: { display: "block", color: "#a1a1aa", marginBottom: 6 },
  linkText: { color: "#fbbf24", fontWeight: 900, marginTop: 6, display: "block" },
  linkButton: { border: "1px solid #3f3f46", borderRadius: 12, padding: 12, textAlign: "center", color: "white", textDecoration: "none", fontWeight: 900 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  quickGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  quickButton: { border: "1px solid #7f1d1d", borderRadius: 14, padding: 12, background: "rgba(127,29,29,.35)", color: "white", fontWeight: 900, cursor: "pointer", textAlign: "center" },
  stat: { border: "1px solid #3f3f46", borderRadius: 18, padding: 14, background: "rgba(0,0,0,.55)" },
  dateGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 },
  dateCard: { minHeight: 92, borderRadius: 16, border: "1px solid #3f3f46", padding: 10, background: "#18181b", color: "white", cursor: "pointer", textAlign: "left" },
  calendarHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 },
  monthButton: { width: 42, height: 42, borderRadius: 999, border: "1px solid #7f1d1d", background: "rgba(127,29,29,.5)", color: "white", fontSize: 24, fontWeight: 900, cursor: "pointer" },
  weekdayGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, color: "#a1a1aa", fontSize: 11, fontWeight: 900, textAlign: "center", marginBottom: 6 },
  monthGrid: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 },
  monthDay: { aspectRatio: "1", minHeight: 48, borderRadius: 10, border: "1px solid #3f3f46", padding: 5, background: "rgba(24,24,27,.92)", color: "white", cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden" },
  outsideMonthDay: { opacity: 0.3 },
  calendarSmallText: { fontSize: 9, fontWeight: 800, opacity: .9 },
  finalPill: { fontSize: 8, borderRadius: 999, padding: "2px 4px", background: "rgba(0,0,0,.28)", fontWeight: 900, alignSelf: "flex-start" },
  dmAvailable: { background: "#22c55e", borderColor: "#bbf7d0", color: "#03140a", boxShadow: "0 0 22px rgba(34,197,94,.45)" },
  dmUnavailable: { background: "#dc2626", borderColor: "#fecaca", color: "white", boxShadow: "0 0 22px rgba(220,38,38,.45)" },
  selectedDate: { borderColor: "#fbbf24", borderWidth: 2 },
  finalDate: { background: "#86efac", color: "#03140a", borderColor: "#fef08a", boxShadow: "0 0 26px rgba(134,239,172,.65)" },
  playerRow: { display: "flex", alignItems: "center", gap: 12, border: "1px solid #3f3f46", borderRadius: 16, padding: 12, marginBottom: 10, background: "rgba(0,0,0,.55)" },
  token: { width: 44, height: 44, borderRadius: 999, border: "2px solid #fbbf24", flexShrink: 0 },
  tokenImage: { width: 44, height: 44, borderRadius: 999, border: "2px solid #fbbf24", objectFit: "cover", flexShrink: 0 },
  tokenLarge: { width: 64, height: 64, borderRadius: 999, border: "2px solid #fbbf24", flexShrink: 0 },
  tokenLargeImage: { width: 64, height: 64, borderRadius: 999, border: "2px solid #fbbf24", objectFit: "cover", flexShrink: 0 },
  tokenGrid: { display: "flex", flexWrap: "wrap", gap: 12, margin: "10px 0" },
  playerBadge: { width: 92, border: "1px solid #3f3f46", borderRadius: 16, padding: 10, background: "rgba(0,0,0,.45)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 },
  badgeName: { display: "flex", alignItems: "center", gap: 6, maxWidth: "100%", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontWeight: 800 },
  dot: { width: 9, height: 9, borderRadius: 99, flexShrink: 0 },
  colorButton: { width: 34, height: 34, borderRadius: 999, border: "2px solid white", cursor: "pointer" },
  rowWrap: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 },
  membershipRow: { border: "1px solid #3f3f46", borderRadius: 16, padding: 12, marginBottom: 12, background: "rgba(0,0,0,.35)" },
  activeMembershipRow: { borderColor: "#22c55e", background: "rgba(6,78,59,.32)" },
  resultRow: { display: "grid", gridTemplateColumns: "1fr", gap: 4, border: "1px solid #3f3f46", borderRadius: 14, padding: 12, marginTop: 10, background: "rgba(0,0,0,.35)", color: "#e5e7eb" },
  featureList: { color: "#e5e7eb", paddingLeft: 20, lineHeight: 1.7 },
  activePlan: { borderColor: "#22c55e", background: "rgba(6,78,59,.45)" },
  sectionHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 },
  miniButton: { border: "1px solid #7f1d1d", borderRadius: 999, padding: "8px 10px", background: "rgba(127,29,29,.45)", color: "white", fontWeight: 800, cursor: "pointer" },
  overviewWeekdays: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5, color: "#a1a1aa", fontSize: 10, fontWeight: 900, textAlign: "center", marginBottom: 6 },
  overviewGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 },
  overviewDay: { aspectRatio: "1", borderRadius: 8, border: "1px solid #3f3f46", background: "rgba(24,24,27,.9)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" },
  overviewOutsideDay: { opacity: 0.25 },
  accountPlanActions: { display: "flex", flexDirection: "column", gap: 12, marginTop: 16 },
  accountDangerButton: { width: "100%", justifyContent: "center", display: "flex", alignItems: "center", padding: 14 },
  membershipActions: { display: "flex", flexDirection: "column", gap: 10, marginTop: 12 },
  membershipButton: { marginTop: 0 },
  membershipDangerButton: { width: "100%", justifyContent: "center", display: "flex", alignItems: "center", padding: 14 },
  scoreBadge: { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 24, minHeight: 16, borderRadius: 999, padding: "2px 5px", background: "rgba(0,0,0,.5)", color: "white", fontSize: 8, fontWeight: 900, lineHeight: 1 },
  bestScoreBadge: { background: "#facc15", color: "#1c1917", boxShadow: "0 0 10px rgba(250,204,21,.65)" },
  dateOptionDetails: { display: "grid", gap: 4, marginTop: 8, padding: 10, borderRadius: 12, border: "1px solid rgba(250,204,21,.35)", background: "rgba(250,204,21,.08)", color: "#e5e7eb", fontSize: 12 },
  bestDateText: { color: "#fde68a", fontWeight: 900 },
  rankLabelText: { color: "#d1d5db", fontWeight: 800 },
  bestResultCard: { borderColor: "#facc15", boxShadow: "0 0 24px rgba(250,204,21,.25)", background: "rgba(250,204,21,.08)" }
};
