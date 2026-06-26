import React, { useEffect, useMemo, useRef, useState } from "react";
import { EmailAuthProvider, GoogleAuthProvider, browserLocalPersistence, createUserWithEmailAndPassword, onAuthStateChanged, reauthenticateWithCredential, setPersistence, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, updateEmail, updatePassword } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "./firebase";
import { BarChart3, CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, Copy, Home, LogIn, LogOut, Mail, MessageSquare, Plus, Settings, Shield, Trash2, UserCheck, Users, Zap } from "lucide-react";


const GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-40KPRTKQT8";

function ensureGoogleAnalytics() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag(){ window.dataLayer.push(arguments); };

  if (!document.getElementById("google-analytics-gtag")) {
    const script = document.createElement("script");
    script.id = "google-analytics-gtag";
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_MEASUREMENT_ID}`;
    document.head.appendChild(script);
  }

  if (!window.__dungeonCalendarGoogleAnalyticsInitialized) {
    window.gtag("js", new Date());
    window.gtag("config", GOOGLE_ANALYTICS_MEASUREMENT_ID, { send_page_view: false });
    window.__dungeonCalendarGoogleAnalyticsInitialized = true;
  }
}

function trackGoogleAnalyticsPageView(path) {
  if (typeof window === "undefined") return;
  ensureGoogleAnalytics();
  if (typeof window.gtag === "function") {
    window.gtag("config", GOOGLE_ANALYTICS_MEASUREMENT_ID, {
      page_path: path || `${window.location.pathname}${window.location.search || ""}`,
      page_location: window.location.href,
      page_title: document.title || "Dungeon Calendar"
    });
  }
}

function loadGoogleRecaptchaEnterprise() {
  if (typeof window === "undefined") return Promise.reject(new Error("reCAPTCHA is only available in a browser."));
  if (window.grecaptcha?.enterprise) return Promise.resolve(window.grecaptcha.enterprise);

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[src^="https://www.google.com/recaptcha/enterprise.js"]');

    const finishWhenReady = () => {
      const startedAt = Date.now();
      const waitForEnterprise = () => {
        if (window.grecaptcha?.enterprise) {
          window.grecaptcha.enterprise.ready(() => resolve(window.grecaptcha.enterprise));
          return;
        }
        if (Date.now() - startedAt > 12000) {
          reject(new Error("Google reCAPTCHA did not finish loading. Refresh the page and try again."));
          return;
        }
        window.setTimeout(waitForEnterprise, 100);
      };
      waitForEnterprise();
    };

    if (existingScript) {
      existingScript.addEventListener("load", finishWhenReady, { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Google reCAPTCHA failed to load.")), { once: true });
      finishWhenReady();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.google.com/recaptcha/enterprise.js";
    script.async = true;
    script.defer = true;
    script.onload = finishWhenReady;
    script.onerror = () => reject(new Error("Google reCAPTCHA failed to load."));
    document.head.appendChild(script);
  });
}

async function getGoogleRecaptchaToken(widgetId) {
  const enterprise = await loadGoogleRecaptchaEnterprise();
  const token = enterprise.getResponse(widgetId);
  if (!token) throw new Error("Complete the Google reCAPTCHA before continuing.");
  return token;
}

function Button({ children, className = "", variant = "default", type = "button", ...props }) {
  return (
    <button
      type={type}
      className={classNames(
        "inline-flex items-center justify-center rounded-xl px-4 py-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "ghost" ? "bg-transparent" : "",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function Card({ children, className = "" }) {
  return <div className={classNames("rounded-2xl border", className)}>{children}</div>;
}

function CardContent({ children, className = "" }) {
  return <div className={className}>{children}</div>;
}

const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dungeonMasterId = "dungeon-master";

const GOOGLE_RECAPTCHA_SITE_KEY = "6LekuQctAAAAAOYe49tKqcSKCDuUdkhxG7eUuWdA";

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "results", label: "Results", icon: BarChart3 },
  { id: "settings", label: "Campaign Settings", icon: Settings }
];

const playerColors = [
  "bg-lime-500",
  "bg-cyan-400",
  "bg-fuchsia-500",
  "bg-orange-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-yellow-400",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-indigo-500",
  "bg-teal-400"
];

const defaultPlayers = [];


function createCampaign(name = "", dungeonMasterIds = [], ownerId = "") {
  return {
    id: crypto.randomUUID(),
    ownerId,
    dungeonMasterIds,
    name,
    isEditingName: true,
    availability: {},
    unavailable: {},
    chosenDate: "",
    sessionTime: "18:00",
    sessionDuration: 4,
    reminderHours: 24
  };
}



function normalizeList(values = []) {
  return Array.isArray(values) ? values.filter(Boolean) : [];
}

function normalizeCampaignForSync(campaign = {}) {
  const id = campaign.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  return {
    ...campaign,
    id,
    ownerId: campaign.ownerId || "",
    dungeonMasterIds: normalizeList(campaign.dungeonMasterIds),
    memberIds: normalizeList(campaign.memberIds || campaign.playerIds || campaign.members),
    invitedEmails: normalizeList(campaign.invitedEmails).map((email) => String(email || "").trim().toLowerCase()).filter(Boolean),
    invitedPlayers: Array.isArray(campaign.invitedPlayers) ? campaign.invitedPlayers : [],
    playerTokenImages: campaign.playerTokenImages || {},
    availability: campaign.availability || {},
    unavailable: campaign.unavailable || {},
    chosenDate: campaign.chosenDate || "",
    generatedSessionDates: normalizeList(campaign.generatedSessionDates || []),
    manuallySelectedDates: normalizeList(campaign.manuallySelectedDates || []),
    recurringCadence: campaign.recurringCadence || "weekly",
    recurringSessionCount: Number(campaign.recurringSessionCount || 4),
    sessionTime: campaign.sessionTime || "18:00",
    sessionDuration: campaign.sessionDuration || 4,
    reminderHours: campaign.reminderHours || 24
  };
}

function campaignContentKey(campaign = {}) {
  const clean = normalizeCampaignForSync(campaign);
  const { updatedAt, isEditingName, ...stable } = clean;
  return JSON.stringify(stable);
}

async function saveCampaignToFirestore(campaign) {
  if (!campaign?.id) return false;
  try {
    await setDoc(doc(db, "campaigns", campaign.id), {
      ...normalizeCampaignForSync(campaign),
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return true;
  } catch (error) {
    console.warn("Campaign Firestore save failed:", error);
    return false;
  }
}

function campaignPlayerRecord(player = {}, campaignId = "") {
  const id = player.id || player.uid || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  const email = normalizeEmail(player.email || "");
  return {
    id,
    name: player.name || player.username || email || "Player",
    username: player.username || String(player.name || email || "player").toLowerCase().replace(/\s+/g, ""),
    email,
    phone: player.phone || "",
    role: player.role || "Player",
    campaignIds: Array.from(new Set([...(player.campaignIds || []), campaignId].filter(Boolean))),
    campaignCharacterNames: player.campaignCharacterNames || (campaignId ? { [campaignId]: "" } : {}),
    color: player.color || playerColors[0],
    campaignTokenImages: player.campaignTokenImages || {},
    lockedColorCampaignIds: player.lockedColorCampaignIds || [],
    invitePending: player.invitePending !== false
  };
}

function playerIdentityKey(player = {}) {
  return normalizeEmail(player.email || "") || player.id || player.uid || "";
}

function upsertCampaignPlayer(campaign = {}, player = {}) {
  const campaignId = campaign.id || "";
  const record = campaignPlayerRecord(player, campaignId);
  const recordKey = playerIdentityKey(record);
  const existingPlayers = Array.isArray(campaign.invitedPlayers) ? campaign.invitedPlayers : [];
  const nextInvitedPlayers = existingPlayers.filter((item) => playerIdentityKey(item) !== recordKey && item.id !== record.id);
  const existingTokenImage = campaign.playerTokenImages?.[record.id] || record.campaignTokenImages?.[campaignId] || "";
  const nextRecord = existingTokenImage
    ? {
        ...record,
        campaignTokenImages: {
          ...(record.campaignTokenImages || {}),
          [campaignId]: existingTokenImage
        }
      }
    : record;

  return normalizeCampaignForSync({
    ...campaign,
    memberIds: Array.from(new Set([...(campaign.memberIds || []), record.id].filter(Boolean))),
    invitedEmails: Array.from(new Set([...(campaign.invitedEmails || []), record.email].filter(Boolean).map(normalizeEmail))),
    invitedPlayers: [...nextInvitedPlayers, nextRecord]
  });
}

function removeCampaignPlayer(campaign = {}, player = {}) {
  const id = typeof player === "string" ? player : player.id;
  const email = normalizeEmail(typeof player === "string" ? "" : player.email || "");
  const campaignId = campaign.id || "";
  const playerTokenImages = { ...(campaign.playerTokenImages || {}) };
  if (id) delete playerTokenImages[id];

  const removeFromDateMap = (dateMap = {}) => Object.fromEntries(
    Object.entries(dateMap || {})
      .map(([key, ids]) => [key, (Array.isArray(ids) ? ids : []).filter((playerId) => playerId !== id)])
      .filter(([, ids]) => ids.length > 0)
  );

  return normalizeCampaignForSync({
    ...campaign,
    memberIds: (campaign.memberIds || []).filter((playerId) => playerId !== id),
    invitedEmails: (campaign.invitedEmails || []).filter((item) => normalizeEmail(item) !== email),
    invitedPlayers: (campaign.invitedPlayers || []).filter((item) => item.id !== id && (!email || normalizeEmail(item.email || "") !== email)),
    playerTokenImages,
    availability: removeFromDateMap(campaign.availability),
    unavailable: removeFromDateMap(campaign.unavailable)
  });
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function buildGeneratedSessionDates(finalDateKey, cadence = "weekly", count = 0) {
  if (!finalDateKey || !count) return [];
  const start = new Date(finalDateKey + "T00:00:00");
  const safeCount = Math.max(0, Number(count) || 0);
  const dates = [];
  for (let index = 1; index <= safeCount; index += 1) {
    const next = new Date(start);
    if (cadence === "monthly") next.setMonth(start.getMonth() + index);
    else next.setDate(start.getDate() + (cadence === "biweekly" ? 14 : 7) * index);
    dates.push(dateKey(next));
  }
  return dates;
}

function isGeneratedOnlyDate(campaign, key) {
  if (!campaign || !key) return false;
  const generated = new Set(campaign.generatedSessionDates || []);
  const manual = new Set(campaign.manuallySelectedDates || []);
  return generated.has(key) && !manual.has(key) && campaign.chosenDate !== key;
}

function buildMonth(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function classNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

function dateVisualState({ ids = [], unavailableIds = [], selectedByActive = false, unavailableByActive = false, hasDungeonMasterAvailable = false, hasDungeonMasterUnavailable = false, isChosenDate = false, isDungeonMaster = false }) {
  if (isChosenDate) return "bg-amber-400 text-black ring-4 ring-amber-200 shadow-[0_0_28px_rgba(251,191,36,0.75)]";
  if (hasDungeonMasterAvailable) return "bg-emerald-500 text-black ring-2 ring-emerald-200 shadow-[0_0_22px_rgba(52,211,153,0.65)]";
  if (hasDungeonMasterUnavailable) return "bg-red-600 text-white ring-2 ring-red-200 shadow-[0_0_22px_rgba(239,68,68,0.65)]";
  if (selectedByActive) return "bg-emerald-600 text-white ring-2 ring-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.5)]";
  if (unavailableByActive) return "bg-red-700 text-white ring-2 ring-red-300 shadow-[0_0_18px_rgba(220,38,38,0.5)]";
  if (isDungeonMaster && ids.length > 0) return "bg-emerald-700/80 text-white ring-1 ring-emerald-400/70";
  if (isDungeonMaster && unavailableIds.length > 0) return "bg-red-800/80 text-white ring-1 ring-red-400/70";
  return "bg-zinc-950/65";
}

function DungeonCalendarLogo({ small = false }) {
  return (
    <div className="flex justify-center">
      <img
        src="https://dl.dropboxusercontent.com/scl/fi/zbs7u6pu228z00a85o3zp/Dungion-calender-1.png?rlkey=uzhr4177misvyogjocby6l7h0"
        alt="Dungeon Calendar"
        className={classNames("object-contain drop-shadow-[0_8px_24px_rgba(220,38,38,0.45)]", small ? "w-48" : "w-full max-w-2xl")}
      />
    </div>
  );
}

function AppBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#070504]">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('https://dl.dropboxusercontent.com/scl/fi/pcz1w86zi9ba1z7b6bb4d/360_F_421852062_oLJjfT88cczyu3u28Qy3M2V8xmO8L770.jpg?rlkey=205zonrdob2sp4d39bncbx3jg')" }}
      />
      <div className="absolute inset-0 bg-black/55" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/75" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-black/35" />
    </div>
  );
}

function PlayerToken({ player, campaignId = "", size = "sm", className = "" }) {
  const sizeClass = size === "xl" ? "h-16 w-16" : size === "lg" ? "h-12 w-12" : size === "md" ? "h-9 w-9" : "h-6 w-6";
  const campaignTokenImage = campaignId ? player?.campaignTokenImages?.[campaignId] : "";
  const tokenImage = campaignTokenImage || player?.tokenImage;

  if (tokenImage) {
    return (
      <img
        src={tokenImage}
        alt={`${player.name || "Player"} token`}
        className={classNames(sizeClass, "shrink-0 rounded-full border-2 border-amber-300 object-cover shadow-[0_0_14px_rgba(251,191,36,0.45)]", className)}
      />
    );
  }

  return <span className={classNames(sizeClass, "shrink-0 rounded-full border-2 border-black/30", player?.color, className)} />;
}



const FIRESTORE_PROJECT_ID = "dungeon-calendar-app";

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  }
  if (typeof value === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeFirestoreValue(item)])) } };
  }
  return { stringValue: String(value) };
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, decodeFirestoreValue(item)]));
  return undefined;
}

function decodeFirestoreDocument(document) {
  return Object.fromEntries(Object.entries(document?.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

async function saveUserProfileViaRest(uid, profile) {
  const signedInUser = auth.currentUser;
  if (!signedInUser || signedInUser.uid !== uid) throw new Error("Sign in again before saving your profile.");

  const token = await signedInUser.getIdToken(true);
  const fields = Object.fromEntries(Object.entries(profile).map(([key, value]) => [key, encodeFirestoreValue(value)]));
  const updateMask = Object.keys(profile).map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join("&");
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}${updateMask ? `?${updateMask}` : ""}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields })
  });

  if (!response.ok) {
    let details = "";
    try {
      const errorBody = await response.json();
      details = errorBody?.error?.message || JSON.stringify(errorBody);
    } catch {
      details = await response.text();
    }
    throw new Error(`Firestore REST save failed (${response.status}): ${details}`);
  }

  return true;
}

async function loadUserProfileViaRest(uid) {
  const signedInUser = auth.currentUser;
  if (!signedInUser || signedInUser.uid !== uid) return null;

  const token = await signedInUser.getIdToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore REST load failed (${response.status})`);
  return decodeFirestoreDocument(await response.json());
}

function normalizeEmail(email = "") {
  return email.trim().toLowerCase();
}

function normalizePlan(planId = "free") {
  return ["free", "adventurer", "guildmaster"].includes(planId) ? planId : "free";
}

function normalizeBillingInterval(interval = "monthly") {
  return ["monthly", "yearly"].includes(interval) ? interval : "monthly";
}


function loadCachedUserProfile(uid) {
  return null;
}

function saveCachedUserProfile(uid, profile = {}) {
  // App profile data is stored only in Firebase/Firestore.
}

async function loadUserProfile(uid) {
  const cached = loadCachedUserProfile(uid);
  try {
    const snap = await Promise.race([
      getDoc(doc(db, "users", uid)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Profile load timed out; using cached profile.")), 3000))
    ]);
    const profile = snap.exists() ? snap.data() : null;
    if (profile) saveCachedUserProfile(uid, profile);
    return profile || cached || null;
  } catch (error) {
    console.warn("Firestore SDK profile load failed; trying cache/REST fallback:", error);
    if (cached) return cached;
    try {
      const restProfile = await loadUserProfileViaRest(uid);
      if (restProfile) saveCachedUserProfile(uid, restProfile);
      return restProfile;
    } catch (restError) {
      console.warn("Firestore REST profile load failed; continuing with Firebase Auth only:", restError);
      return null;
    }
  }
}

async function saveUserProfile(uid, profile) {
  saveCachedUserProfile(uid, profile);
  try {
    await setDoc(doc(db, "users", uid), profile, { merge: true });
    return true;
  } catch (error) {
    console.warn("Firestore SDK profile save failed; trying REST fallback:", error);
    try {
      await saveUserProfileViaRest(uid, profile);
      return true;
    } catch (restError) {
      console.warn("Firestore REST profile save failed; login will still continue:", restError);
      return false;
    }
  }
}

async function saveUserProfileRequired(uid, profile) {
  if (!uid) throw new Error("Missing user id for profile save.");
  saveCachedUserProfile(uid, profile);
  try {
    await setDoc(doc(db, "users", uid), profile, { merge: true });
    return true;
  } catch (error) {
    console.warn("Firestore SDK required profile save failed; trying REST fallback:", error);
    await saveUserProfileViaRest(uid, profile);
    return true;
  }
}

async function saveUserProfileQuick(uid, profile) {
  if (!uid) throw new Error("Missing user id for profile save.");
  saveCachedUserProfile(uid, profile);
  const savePromise = setDoc(doc(db, "users", uid), profile, { merge: true });
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Profile save timed out. Check your connection and try again.")), 4500);
  });
  await Promise.race([savePromise, timeoutPromise]);
  return true;
}

function profileSaveErrorMessage(error) {
  const code = error?.code || "";
  if (code === "permission-denied") return "Profile could not be saved because Firestore rules denied access to users/{uid}. Update Firestore rules to allow signed-in users to read/write their own user document.";
  if (code === "unavailable") return "Profile could not be saved because Firestore appears offline or blocked in this browser. The app tried a REST fallback too. Check internet, disable tracking/ad blockers for dungeoncalendar.com, then try again.";
  if ((error?.message || "").includes("Firestore REST save failed")) return error.message;
  return error?.message || "Profile could not be saved. Please try again.";
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
  if (code === "auth/popup-closed-by-user") return "Google sign-in was cancelled before it finished.";
  if (code === "auth/popup-blocked") return "Your browser blocked the Google sign-in popup. Allow popups for this site and try again.";
  if (code === "auth/unauthorized-domain") return "This domain is not authorized for Firebase login. Add dungeoncalendar.com and www.dungeoncalendar.com in Firebase Authentication > Settings > Authorized domains.";
  if (code === "auth/operation-not-allowed") return "Google sign-in is not enabled. Open Firebase Console > Authentication > Sign-in method and enable Google.";
  return error?.message || "Authentication failed.";
}

function shouldUseRedirectGoogleLogin() {
  if (typeof window === "undefined") return false;
  const userAgent = window.navigator?.userAgent || "";
  const isAndroid = /Android/i.test(userAgent);
  const isSmallTouchScreen = window.matchMedia?.("(max-width: 900px)")?.matches && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
  const isReactNativeWebView = !!window.ReactNativeWebView;
  return isReactNativeWebView || isAndroid || isSmallTouchScreen;
}

function firebaseProfileToPlayer(uid, profile = {}, fallbackEmail = "") {
  const email = normalizeEmail(profile.email || fallbackEmail);
  const name = profile.name || profile.username || email || "Player";
  return {
    id: uid,
    role: profile.role || "Player",
    username: profile.username || name.toLowerCase().replace(/\s+/g, "") || email.split("@")[0] || "player",
    name,
    email,
    password: "",
    phone: profile.phone || "",
    plan: normalizePlan(profile.plan || "free"),
    billingInterval: normalizeBillingInterval(profile.billingInterval || "monthly"),
    campaignIds: profile.campaignIds || [],
    campaignCharacterNames: profile.campaignCharacterNames || {},
    lockedColorCampaignIds: profile.lockedColorCampaignIds || [],
    color: profile.color || playerColors[0],
    campaignTokenImages: profile.campaignTokenImages || {}
  };
}

export default function DungeonCalendarApp() {
  const today = new Date();
  const [page, setPage] = useState("dashboard");

  useEffect(() => {
    if (page === "players") setPage("settings");
  }, [page]);
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const dates = useMemo(() => buildMonth(viewDate.getFullYear(), viewDate.getMonth()), [viewDate]);
  const [players, setPlayers] = useState(defaultPlayers);
  const [currentUserId, setCurrentUserId] = useState("");
  const [activePlayerId, setActivePlayerId] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginName, setLoginName] = useState("");
  const [campaignCharacterNames, setCampaignCharacterNames] = useState({});
  const [loginError, setLoginError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const recaptchaContainerRef = useRef(null);
  const recaptchaWidgetIdRef = useRef(null);
  const [authProfileLoaded, setAuthProfileLoaded] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [availabilityMode, setAvailabilityMode] = useState("available");
  const [recurringCadence, setRecurringCadence] = useState("weekly");
  const [recurringSessionCount, setRecurringSessionCount] = useState(4);
  const [campaigns, setCampaigns] = useState([]);
  const [activeCampaignId, setActiveCampaignId] = useState("");
  const [newPlayer, setNewPlayer] = useState("");
  const [newPlayerEmail, setNewPlayerEmail] = useState("");
  const [newPlayerPhone, setNewPlayerPhone] = useState("");
  const [copied, setCopied] = useState(false);
  const [emailInvitePlayer, setEmailInvitePlayer] = useState(null);
  const [emailInviteCopied, setEmailInviteCopied] = useState(false);
  const [emailInviteMessage, setEmailInviteMessage] = useState("");
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [accountUsername, setAccountUsername] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [editingField, setEditingField] = useState("");
  const [showPasswordVerify, setShowPasswordVerify] = useState(false);
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState("");
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [confirmPasswordInput, setConfirmPasswordInput] = useState("");
  const [showCurrentPasswordText, setShowCurrentPasswordText] = useState(false);
  const [showNewPasswordText, setShowNewPasswordText] = useState(false);
  const [showConfirmPasswordText, setShowConfirmPasswordText] = useState(false);
  const [plan, setPlan] = useState("free");
  const [billingInterval, setBillingInterval] = useState("monthly");
  const [billingMessage, setBillingMessage] = useState("");
  const [selectedPaymentPlan, setSelectedPaymentPlan] = useState("");
  const [selectedBillingInterval, setSelectedBillingInterval] = useState("monthly");
  const [paymentMethod, setPaymentMethod] = useState("stripe");
  const [paymentName, setPaymentName] = useState("");
  const [paymentEmail, setPaymentEmail] = useState("");
  const [paymentCardNumber, setPaymentCardNumber] = useState("");
  const [paymentExpiry, setPaymentExpiry] = useState("");
  const [paymentCvc, setPaymentCvc] = useState("");
  const [stripeVerifyLoading, setStripeVerifyLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [pendingStripeActivation, setPendingStripeActivation] = useState(null);
  const [stripeAutoVerifyAttempted, setStripeAutoVerifyAttempted] = useState(false);
  const [stripeLoginVerifyUserId, setStripeLoginVerifyUserId] = useState("");
  const [publicRoute, setPublicRoute] = useState(() => typeof window !== "undefined" ? window.location.pathname : "/");

  useEffect(() => {
    ensureGoogleAnalytics();
  }, []);

  useEffect(() => {
    const trackedPath = publicRoute && publicRoute !== "/" ? publicRoute : `/${page || "dashboard"}`;
    trackGoogleAnalyticsPageView(trackedPath);
  }, [publicRoute, page]);
  const lastSavedCampaignContentKeyRef = useRef("");
  const loadingCampaignsFromFirestoreRef = useRef(false);

  const planOrder = ["free", "adventurer", "guildmaster"];

  function getPlanRank(planId) {
    return planOrder.indexOf(planId);
  }

  function getPlanActionLabel(planId) {
    if (planId === plan) return "Active";
    return getPlanRank(planId) > getPlanRank(plan)
      ? `Upgrade to ${planLimits[planId].name}`
      : `Downgrade to ${planLimits[planId].name}`;
  }

  const planLimits = {
    free: {
      name: "Free",
      campaigns: 1,
      price: "$0",
      monthlyPrice: 0,
      yearlyPrice: 0
    },
    adventurer: {
      name: "Adventurer",
      campaigns: 5,
      price: "$2.99",
      monthlyPrice: 2.99,
      yearlyPrice: 29.99
    },
    guildmaster: {
      name: "Guildmaster",
      campaigns: Infinity,
      price: "$4.99",
      monthlyPrice: 4.99,
      yearlyPrice: 49.99
    }
  };


  function formatPlanPrice(planId, interval = billingInterval) {
    const planInfo = planLimits[planId] ?? planLimits.free;
    if (planId === "free") return "$0";
    const amount = interval === "yearly" ? planInfo.yearlyPrice : planInfo.monthlyPrice;
    const suffix = interval === "yearly" ? "/year" : "/month";
    return `$${Number(amount).toFixed(2)}${suffix}`;
  }

  function yearlySavingsLabel(planId) {
    const planInfo = planLimits[planId] ?? planLimits.free;
    if (planId === "free") return "";
    const monthlyAnnualTotal = planInfo.monthlyPrice * 12;
    const savings = monthlyAnnualTotal - planInfo.yearlyPrice;
    return savings > 0 ? `Save $${savings.toFixed(2)} yearly` : "";
  }

  const planFeatures = {
    free: {
      autoPick: false,
      calendarExport: false,
      fullTracking: false,
      playerInvites: true,
      advancedManagement: false
    },
    adventurer: {
      autoPick: true,
      calendarExport: true,
      fullTracking: false,
      playerInvites: true,
      advancedManagement: false
    },
    guildmaster: {
      autoPick: true,
      calendarExport: true,
      fullTracking: true,
      playerInvites: true,
      advancedManagement: true,
      tokenUploads: true
    }
  };

  function hasPlanFeature(feature) {
    return !!planFeatures[plan]?.[feature];
  }

  async function updatePlayerToken(playerId, file, campaignId = activeCampaign?.id) {
    if (!file || !campaignId || !playerId) return;

    if (!hasPlanFeature("tokenUploads")) {
      setBillingMessage("Custom player token images are included with the Guildmaster plan.");
      setPage("billing");
      return;
    }

    try {
      const safeFileName = `${playerId}-${Date.now()}-${String(file.name || "token").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const tokenImageRef = storageRef(storage, `token-images/${campaignId}/${safeFileName}`);
      await uploadBytes(tokenImageRef, file, { contentType: file.type || "image/png" });
      const tokenUrl = await getDownloadURL(tokenImageRef);

      setPlayers((current) => current.map((player) => {
        if (player.id !== playerId) return player;
        return {
          ...player,
          campaignTokenImages: {
            ...(player.campaignTokenImages || {}),
            [campaignId]: tokenUrl
          }
        };
      }));

      setCampaigns((current) => current.map((campaign) => {
        if (campaign.id !== campaignId) return campaign;
        const updatedInvitedPlayers = (campaign.invitedPlayers || []).map((player) => {
          if (player.id !== playerId) return player;
          return {
            ...player,
            campaignTokenImages: {
              ...(player.campaignTokenImages || {}),
              [campaignId]: tokenUrl
            }
          };
        });
        const nextCampaign = normalizeCampaignForSync({
          ...campaign,
          invitedPlayers: updatedInvitedPlayers,
          playerTokenImages: {
            ...(campaign.playerTokenImages || {}),
            [playerId]: tokenUrl
          }
        });
        saveCampaignToFirestore(nextCampaign);
        return nextCampaign;
      }));
    } catch (error) {
      console.error("Token upload failed:", error);
      setBillingMessage(error?.message || "Token upload failed. Check Firebase Storage rules and try again.");
    }
  }

  function removePlayerToken(playerId, campaignId = activeCampaign?.id) {
    if (!campaignId) return;

    setPlayers((current) => current.map((player) => {
      if (player.id !== playerId) return player;

      const nextTokenImages = { ...(player.campaignTokenImages || {}) };
      delete nextTokenImages[campaignId];

      return {
        ...player,
        campaignTokenImages: nextTokenImages
      };
    }));

    setCampaigns((current) => current.map((campaign) => {
      if (campaign.id !== campaignId) return campaign;
      const nextPlayerTokenImages = { ...(campaign.playerTokenImages || {}) };
      delete nextPlayerTokenImages[playerId];
      const nextCampaign = normalizeCampaignForSync({
        ...campaign,
        playerTokenImages: nextPlayerTokenImages,
        invitedPlayers: (campaign.invitedPlayers || []).map((player) => {
          if (player.id !== playerId) return player;
          const images = { ...(player.campaignTokenImages || {}) };
          delete images[campaignId];
          return { ...player, campaignTokenImages: images };
        })
      });
      saveCampaignToFirestore(nextCampaign);
      return nextCampaign;
    }));
  }

  const currentUser = players.find((player) => player.id === currentUserId);
  const activePlayer = players.find((player) => player.id === activePlayerId);
  const visibleCampaigns = useMemo(() => {
    if (!currentUser) return [];
    const userEmail = normalizeEmail(currentUser.email || "");
    return campaigns.map(normalizeCampaignForSync).filter((campaign) =>
      (currentUser.campaignIds ?? []).includes(campaign.id) ||
      (campaign.memberIds ?? []).includes(currentUser.id) ||
      (campaign.dungeonMasterIds ?? []).includes(currentUser.id) ||
      campaign.ownerId === currentUser.id ||
      (!!userEmail && (campaign.invitedEmails || []).map(normalizeEmail).includes(userEmail))
    );
  }, [campaigns, currentUser]);
  const activeCampaign = visibleCampaigns.find((campaign) => campaign.id === activeCampaignId) ?? visibleCampaigns[0];
  const availability = activeCampaign?.availability ?? {};
  const unavailable = activeCampaign?.unavailable ?? {};
  const dungeonMasterIds = activeCampaign?.dungeonMasterIds ?? [];
  const campaignName = activeCampaign?.name ?? "";
  const isEditingCampaignName = activeCampaign?.isEditingName ?? true;
  const chosenDate = activeCampaign?.chosenDate ?? "";
  const generatedSessionDates = activeCampaign?.generatedSessionDates ?? [];
  const sessionTime = activeCampaign?.sessionTime ?? "18:00";
  const sessionDuration = activeCampaign?.sessionDuration ?? 4;
  const reminderHours = activeCampaign?.reminderHours ?? 24;
  const isDungeonMaster = !!currentUser && !!activeCampaign?.dungeonMasterIds?.includes(currentUser.id);
  const activeCampaignRole = isDungeonMaster ? "Dungeon Master" : "Player";
  const activeCampaignPlayers = useMemo(() => {
    if (!activeCampaign?.id) return [];
    const campaignId = activeCampaign.id;
    const campaignRecords = (activeCampaign.invitedPlayers || []).map((player) => campaignPlayerRecord(player, campaignId));
    const relevantPlayers = [
      ...players.filter((player) =>
        (player.campaignIds ?? []).includes(campaignId) ||
        (activeCampaign.memberIds ?? []).includes(player.id) ||
        activeCampaign?.dungeonMasterIds?.includes(player.id)
      ),
      ...campaignRecords
    ].map((player) => {
      const tokenFromCampaign = activeCampaign.playerTokenImages?.[player.id];
      return tokenFromCampaign ? {
        ...player,
        campaignTokenImages: {
          ...(player.campaignTokenImages || {}),
          [campaignId]: tokenFromCampaign
        }
      } : player;
    });

    return relevantPlayers.filter((player, index, list) => {
      const key = normalizeEmail(player.email || "") || player.name?.toLowerCase() || player.id;
      const matchingPlayers = list.filter((candidate) =>
        (normalizeEmail(candidate.email || "") || candidate.name?.toLowerCase() || candidate.id) === key
      );
      const matchingDungeonMaster = matchingPlayers.find((candidate) => activeCampaign?.dungeonMasterIds?.includes(candidate.id));

      if (matchingDungeonMaster) return player.id === matchingDungeonMaster.id;
      return index === list.findIndex((candidate) =>
        (normalizeEmail(candidate.email || "") || candidate.name?.toLowerCase() || candidate.id) === key
      );
    });
  }, [players, activeCampaign]);

  function canViewPlayerResponses() {
    return isDungeonMaster;
  }

  function visibleResponseIds(ids = []) {
    if (canViewPlayerResponses()) return ids;
    return ids.filter((id) => dungeonMasterIds.includes(id) || id === currentUserId);
  }

  function isDungeonMasterResponse(id) {
    return dungeonMasterIds.includes(id);
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthProfileLoaded(false);
      if (!user) {
        setCurrentUserId("");
        setActivePlayerId("");
        setAuthProfileLoaded(true);
        return;
      }

      try {
        const profile = await loadUserProfile(user.uid);
        const localMatch = players.find((player) =>
          player.id === user.uid || normalizeEmail(player.email) === normalizeEmail(user.email || "")
        );
        const firebasePlayer = firebaseProfileToPlayer(user.uid, profile || localMatch || {}, user.email || "");
        setPlan(normalizePlan(profile?.plan || localMatch?.plan || firebasePlayer.plan || "free"));
        setBillingInterval(normalizeBillingInterval(profile?.billingInterval || localMatch?.billingInterval || firebasePlayer.billingInterval || "monthly"));

        setPlayers((current) => {
          const withoutDuplicate = current.filter((player) =>
            player.id !== user.uid && normalizeEmail(player.email) !== normalizeEmail(firebasePlayer.email)
          );
          return [...withoutDuplicate, firebasePlayer];
        });

        setCurrentUserId(user.uid);
        setActivePlayerId(user.uid);
        if (firebasePlayer.campaignIds?.[0]) setActiveCampaignId(firebasePlayer.campaignIds[0]);
        setPage("calendar");
      } catch (error) {
        console.error("Failed to restore Firebase login:", error);
      } finally {
        setAuthProfileLoaded(true);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUserId || auth.currentUser?.uid !== currentUserId) return undefined;

    const userRef = doc(db, "users", currentUserId);
    const unsubscribeProfile = onSnapshot(userRef, (snapshot) => {
      if (!snapshot.exists()) return;

      const profile = snapshot.data();
      saveCachedUserProfile(currentUserId, profile);
      const syncedPlayer = firebaseProfileToPlayer(currentUserId, profile, auth.currentUser?.email || "");

      setPlan(normalizePlan(profile?.plan || syncedPlayer.plan || "free"));
      setBillingInterval(normalizeBillingInterval(profile?.billingInterval || syncedPlayer.billingInterval || "monthly"));
      setPlayers((current) => {
        const withoutDuplicate = current.filter((player) =>
          player.id !== currentUserId && normalizeEmail(player.email) !== normalizeEmail(syncedPlayer.email)
        );
        return [...withoutDuplicate, syncedPlayer];
      });
    }, (error) => {
      console.warn("Live profile sync failed:", error);
    });

    return () => unsubscribeProfile();
  }, [currentUserId]);


  useEffect(() => {
    if (!currentUserId || !currentUser) return undefined;

    const unsubscribeCampaigns = onSnapshot(collection(db, "campaigns"), (snapshot) => {
      loadingCampaignsFromFirestoreRef.current = true;
      const remoteCampaigns = snapshot.docs.map((item) => normalizeCampaignForSync({ id: item.id, ...item.data() }));
      const userEmail = normalizeEmail(currentUser.email || "");
      const visibleRemoteCampaigns = remoteCampaigns.filter((campaign) =>
        (currentUser.campaignIds || []).includes(campaign.id) ||
        (campaign.memberIds || []).includes(currentUserId) ||
        (campaign.dungeonMasterIds || []).includes(currentUserId) ||
        campaign.ownerId === currentUserId ||
        (!!userEmail && (campaign.invitedEmails || []).map(normalizeEmail).includes(userEmail))
      );

      if (visibleRemoteCampaigns.length) {
        setCampaigns((current) => {
          const remoteIds = new Set(visibleRemoteCampaigns.map((campaign) => campaign.id));
          const remainingLocal = current.filter((campaign) => !remoteIds.has(campaign.id));
          return [...remainingLocal, ...visibleRemoteCampaigns];
        });

        const remotePlayers = visibleRemoteCampaigns.flatMap((campaign) => (campaign.invitedPlayers || []).map((player) => campaignPlayerRecord(player, campaign.id)));
        if (remotePlayers.length) {
          setPlayers((current) => {
            const merged = [...current];
            remotePlayers.forEach((remotePlayer) => {
              const key = normalizeEmail(remotePlayer.email || "") || remotePlayer.id;
              const index = merged.findIndex((player) => (normalizeEmail(player.email || "") || player.id) === key);
              if (index >= 0) {
                merged[index] = {
                  ...merged[index],
                  ...remotePlayer,
                  campaignIds: Array.from(new Set([...(merged[index].campaignIds || []), ...(remotePlayer.campaignIds || [])])),
                  campaignCharacterNames: { ...(merged[index].campaignCharacterNames || {}), ...(remotePlayer.campaignCharacterNames || {}) },
                  campaignTokenImages: { ...(merged[index].campaignTokenImages || {}), ...(remotePlayer.campaignTokenImages || {}) }
                };
              } else {
                merged.push(remotePlayer);
              }
            });
            return merged;
          });
        }
      }
      setTimeout(() => { loadingCampaignsFromFirestoreRef.current = false; }, 0);
    }, (error) => console.warn("Campaign live sync failed:", error));

    return () => unsubscribeCampaigns();
  }, [currentUserId, currentUser?.email, currentUser?.campaignIds]);

  useEffect(() => {
    if (!currentUserId || loadingCampaignsFromFirestoreRef.current) return;
    const contentKey = JSON.stringify(campaigns.map(campaignContentKey).sort());
    if (contentKey === lastSavedCampaignContentKeyRef.current) return;
    lastSavedCampaignContentKeyRef.current = contentKey;
    campaigns.map(normalizeCampaignForSync).forEach((campaign) => {
      if (campaign.id) saveCampaignToFirestore(campaign);
    });
  }, [campaigns, currentUserId]);




  useEffect(() => {
    if (!currentUser) return;
    if (visibleCampaigns.length === 0) {
      if (activeCampaignId) setActiveCampaignId("");
      return;
    }
    if (!activeCampaignId || !visibleCampaigns.some((campaign) => campaign.id === activeCampaignId)) {
      setActiveCampaignId(visibleCampaigns[0].id);
    }
  }, [activeCampaignId, currentUser, visibleCampaigns]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteCampaignId = params.get("campaign");
    const inviteName = params.get("name");

    if (inviteName && !loginName) {
      setLoginName(inviteName);
    }

    if (inviteCampaignId && campaigns.some((campaign) => campaign.id === inviteCampaignId)) {
      setActiveCampaignId(inviteCampaignId);
    }
  }, [campaigns, loginName]);

  useEffect(() => {
    if (currentUser && !editingField && !showPasswordVerify) {
      setAccountUsername(currentUser.username ?? "");
      setAccountName(currentUser.name ?? "");
      setAccountPhone(currentUser.phone ?? "");
      setAccountEmail(currentUser.email ?? auth.currentUser?.email ?? "");
      setAccountPassword("");
      setAccountMessage("");
    }
  }, [currentUser, editingField, showPasswordVerify]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeCancelled = params.get("stripe_cancelled") === "true";
    const stripeSuccess = params.get("stripe_success") === "true" || params.get("payment_success") === "true" || params.get("stripe_sync") === "true";

    if (stripeSuccess && window.location.pathname !== "/subscription-complete") {
      const nextUrl = `/subscription-complete${window.location.search || ""}`;
      window.history.replaceState({}, document.title, nextUrl);
      setPublicRoute("/subscription-complete");
      return;
    }

    if (stripeCancelled) {
      setBillingMessage("Stripe Checkout was cancelled. No plan changes were made.");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  function readPendingStripePlan() {
    let pending = null;

    const profilePendingPlan = normalizePlan(currentUser?.pendingStripePlan || "free");
    if ((!pending?.plan || normalizePlan(pending.plan) === "free") && profilePendingPlan !== "free") {
      pending = {
        uid: currentUser?.id || auth.currentUser?.uid || "",
        plan: profilePendingPlan,
        billingInterval: normalizeBillingInterval(currentUser?.pendingStripeBillingInterval || currentUser?.pendingBillingInterval || "monthly"),
        startedAt: currentUser?.pendingStripeStartedAt || currentUser?.updatedAt || ""
      };
    }

    return pending;
  }

  function syncPendingStripeActivationFromStorage() {
    const pending = readPendingStripePlan();
    if (!pending?.plan || normalizePlan(pending.plan) === "free") {
      setPendingStripeActivation(null);
      return null;
    }

    const uid = currentUser?.id || auth.currentUser?.uid || "";
    const pendingUserMatches = !pending.uid || !uid || pending.uid === uid;

    if (!pendingUserMatches) {
      setPendingStripeActivation(null);
      return pending;
    }

    const nextPending = {
      plan: normalizePlan(pending.plan),
      billingInterval: normalizeBillingInterval(pending.billingInterval || pending.interval || "monthly"),
      startedAt: pending.startedAt || ""
    };

    setPendingStripeActivation(nextPending);
    return nextPending;
  }

  async function activateStripePlan(planId, interval = "monthly", source = "stripe_payment_link") {
    const safePlan = normalizePlan(planId);
    const safeInterval = normalizeBillingInterval(interval);

    if (!currentUser || auth.currentUser?.uid !== currentUser.id) {
      setBillingMessage("Sign in with the account that completed Stripe checkout, then return to this page to activate the plan.");
      return;
    }

    if (safePlan === "free") {
      setBillingMessage("Stripe checkout returned without a paid plan. Choose a paid plan again or contact support.");
      return;
    }

    await persistPlan(safePlan, safeInterval, {
      pendingStripePlan: "free",
      pendingStripeBillingInterval: "monthly",
      pendingStripeStartedAt: "",
      stripePaymentLinkActivatedAt: new Date().toISOString(),
      stripeActivationSource: source
    });

    setPendingStripeActivation(null);
    setSelectedPaymentPlan("");
    setCheckoutLoading(false);
    setBillingMessage(`${planLimits[safePlan]?.name || "Paid"} plan activated. Billing: ${safeInterval}.`);
  }

  useEffect(() => {
    if (!currentUser || auth.currentUser?.uid !== currentUser.id) return;

    const params = new URLSearchParams(window.location.search);
    const stripeSuccess = params.get("stripe_success") === "true" || params.get("payment_success") === "true" || params.get("stripe_sync") === "true";
    const urlPlan = params.get("stripe_plan") || params.get("plan");
    const urlBilling = params.get("stripe_billing") || params.get("billing") || params.get("interval");
    const pending = readPendingStripePlan();
    const pendingUserMatches = !pending?.uid || pending.uid === currentUser.id;

    syncPendingStripeActivationFromStorage();

    if (pending && !pendingUserMatches) {
      if (stripeSuccess || urlPlan) {
        setBillingMessage("Stripe checkout completed, but it was started by a different signed-in account. Sign in with the checkout account and reload this page.");
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      return;
    }

    // Stripe Payment Links, coupon-code checkouts, and Stripe's "you already have a subscription"
    // page may return without the plan query parameters. The selected plan is saved before
    // redirecting to Stripe, then reused on the return path.
    const returnedFromStripe = typeof document !== "undefined" && /stripe\.com/i.test(document.referrer || "");

    if (!stripeSuccess && !urlPlan && !returnedFromStripe) return;

    const planToActivate = normalizePlan(urlPlan || pending?.plan || currentUser?.pendingStripePlan || "free");
    const intervalToActivate = normalizeBillingInterval(urlBilling || pending?.billingInterval || pending?.interval || currentUser?.pendingStripeBillingInterval || "monthly");

    activateStripePlan(planToActivate, intervalToActivate, stripeSuccess || urlPlan ? "stripe_return" : "stripe_coupon_or_existing_subscription_return")
      .catch((error) => setBillingMessage(profileSaveErrorMessage(error)))
      .finally(() => {
        window.history.replaceState({}, document.title, window.location.pathname);
      });
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser || auth.currentUser?.uid !== currentUser.id) return undefined;

    const refreshPending = () => {
      const pending = syncPendingStripeActivationFromStorage();
      if (pending?.plan && normalizePlan(pending.plan) !== "free" && !stripeAutoVerifyAttempted) {
        setPage("billing");
        setStripeAutoVerifyAttempted(true);
        setTimeout(() => verifyStripeSubscriptionByEmail("automatic_return_from_stripe_or_existing_subscription"), 250);
      }
    };
    refreshPending();

    window.addEventListener("focus", refreshPending);
    window.addEventListener("pageshow", refreshPending);
    document.addEventListener("visibilitychange", refreshPending);

    return () => {
      window.removeEventListener("focus", refreshPending);
      window.removeEventListener("pageshow", refreshPending);
      document.removeEventListener("visibilitychange", refreshPending);
    };
  }, [currentUser?.id, stripeAutoVerifyAttempted]);

  useEffect(() => {
    if (!currentUser || auth.currentUser?.uid !== currentUser.id) return;
    if (stripeLoginVerifyUserId === currentUser.id) return;

    const email = normalizeEmail(currentUser.email || auth.currentUser?.email || "");
    if (!email) return;

    setStripeLoginVerifyUserId(currentUser.id);
    const timer = setTimeout(() => {
      verifyStripeSubscriptionByEmail("automatic_login_subscription_check");
    }, 1000);

    return () => clearTimeout(timer);
  }, [currentUser?.id, currentUser?.email, stripeLoginVerifyUserId]);

  useEffect(() => {
    if (!currentUser || auth.currentUser?.uid !== currentUser.id) return;
    const pendingPlan = normalizePlan(currentUser.pendingStripePlan || "free");
    if (pendingPlan === "free" || plan !== "free") return;

    let cancelled = false;
    const pendingInterval = normalizeBillingInterval(currentUser.pendingStripeBillingInterval || "monthly");

    const activateFromCustomerDoc = async () => {
      try {
        const customerSnap = await getDoc(doc(db, "customers", currentUser.id));
        if (cancelled || !customerSnap.exists()) return;

        const customerData = customerSnap.data() || {};
        const status = String(
          customerData.subscriptionStatus ||
          customerData.status ||
          customerData.stripeSubscriptionStatus ||
          ""
        ).toLowerCase();

        const hasStripeCustomer = !!(
          customerData.stripeId ||
          customerData.stripeCustomerId ||
          customerData.customerId ||
          customerData.stripeLink
        );

        const hasPaidSignal = !!(
          customerData.subscriptionId ||
          customerData.stripeSubscriptionId ||
          customerData.priceId ||
          customerData.productId ||
          customerData.plan ||
          customerData.active === true ||
          ["active", "trialing", "paid"].includes(status) ||
          hasStripeCustomer
        );

        if (!hasPaidSignal) return;

        await persistPlan(pendingPlan, pendingInterval, {
          pendingStripePlan: "free",
          pendingStripeBillingInterval: "monthly",
          pendingStripeStartedAt: "",
          stripePaymentLinkActivatedAt: new Date().toISOString(),
          stripeActivationSource: "firestore_customer_pending_plan_sync"
        });
      } catch (error) {
        console.warn("Pending Stripe Firestore activation check failed:", error);
      }
    };

    activateFromCustomerDoc();
    const timer = setTimeout(activateFromCustomerDoc, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentUser?.id, currentUser?.pendingStripePlan, currentUser?.pendingStripeBillingInterval, plan]);

  const bestDates = useMemo(() => {
    return Object.entries(availability)
      .filter(([key]) => !isGeneratedOnlyDate(activeCampaign, key))
      .map(([key, ids]) => ({ key, count: ids.length, names: ids.map((id) => { const player = players.find((p) => p.id === id); return player?.campaignCharacterNames?.[activeCampaign?.id] || player?.name; }).filter(Boolean) }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }, [availability, players, activeCampaign]);

  const selectedDateLabel = chosenDate ? new Date(chosenDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "No sessions scheduled yet.";

  useEffect(() => {
    if (currentUser || !recaptchaContainerRef.current || typeof window === "undefined") return;
    let cancelled = false;

    loadGoogleRecaptchaEnterprise()
      .then((enterprise) => {
        if (cancelled || !recaptchaContainerRef.current || recaptchaWidgetIdRef.current !== null) return;
        recaptchaWidgetIdRef.current = enterprise.render(recaptchaContainerRef.current, {
          sitekey: GOOGLE_RECAPTCHA_SITE_KEY,
          action: "LOGIN"
        });
      })
      .catch((error) => setLoginError(error.message));

    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  function updateActiveCampaign(updater) {
    if (!activeCampaign?.id) return;
    setCampaigns((current) => current.map((campaign) => {
      if (campaign.id !== activeCampaign.id) return campaign;
      const nextCampaign = normalizeCampaignForSync({ ...campaign, ...updater(campaign) });
      saveCampaignToFirestore(nextCampaign);
      return nextCampaign;
    }));
  }

  async function login() {
    if (authBusy) return;
    setAuthBusy(true);
    setLoginError("");
    const trimmedName = loginName.trim();
    const trimmedEmail = normalizeEmail(loginEmail);

    if (!trimmedEmail || !loginPassword.trim()) {
      setLoginError("Enter your email and password.");
      setAuthBusy(false);
      return;
    }

    if (authMode === "create" && !trimmedName) {
      setLoginError("Enter your name before creating an account.");
      setAuthBusy(false);
      return;
    }

    try {
      await getGoogleRecaptchaToken(recaptchaWidgetIdRef.current);

      let uid = "";
      let player;

      await setPersistence(auth, browserLocalPersistence);

      if (authMode === "login") {
        const credential = await signInWithEmailAndPassword(auth, trimmedEmail, loginPassword);
        uid = credential.user.uid;
        const profile = await loadUserProfile(uid);
        const existingLocal = players.find((item) => item.id === uid || normalizeEmail(item.email) === trimmedEmail);

        player = {
          ...firebaseProfileToPlayer(uid, profile || existingLocal || {}, trimmedEmail),
          color: profile?.color || existingLocal?.color || playerColors.find((color) => !players.some((item) => item.color === color)) || playerColors[0],
          plan: normalizePlan(profile?.plan || existingLocal?.plan || "free"),
          campaignIds: profile?.campaignIds || existingLocal?.campaignIds || []
        };
      } else {
        const credential = await createUserWithEmailAndPassword(auth, trimmedEmail, loginPassword);
        uid = credential.user.uid;
        const existingInvite = players.find((item) => normalizeEmail(item.email) === trimmedEmail);

        player = {
          id: uid,
          role: "Player",
          username: existingInvite?.username || trimmedName.toLowerCase().replace(/\s+/g, ""),
          name: trimmedName,
          email: trimmedEmail,
          password: "",
          phone: existingInvite?.phone || "",
          campaignCharacterNames: existingInvite?.campaignCharacterNames || (activeCampaign?.id ? { [activeCampaign.id]: "" } : {}),
          campaignIds: existingInvite?.campaignIds?.length ? existingInvite.campaignIds : (activeCampaign?.id ? [activeCampaign.id] : []),
          color: existingInvite?.color || playerColors.find((color) => !players.some((item) => item.color === color)) || playerColors[0],
          plan: normalizePlan(existingInvite?.plan || "free"),
          campaignTokenImages: existingInvite?.campaignTokenImages || {},
          lockedColorCampaignIds: existingInvite?.lockedColorCampaignIds || []
        };

        await saveUserProfile(uid, player);
      }

      setPlayers((current) => {
        const withoutDuplicate = current.filter((item) => item.id !== uid && normalizeEmail(item.email) !== trimmedEmail);
        return [...withoutDuplicate, player];
      });

      setPlan(normalizePlan(player.plan || "free"));
      setCurrentUserId(uid);
      setActivePlayerId(uid);
      if (player.campaignIds?.[0]) setActiveCampaignId(player.campaignIds[0]);
      setPage("calendar");
      setLoginError("");
    } catch (error) {
      setLoginError(authErrorMessage(error));
    } finally {
      if (typeof window !== "undefined" && window.grecaptcha?.enterprise && recaptchaWidgetIdRef.current !== null) {
        window.grecaptcha.enterprise.reset(recaptchaWidgetIdRef.current);
      }
      setAuthBusy(false);
    }
  }


  useEffect(() => {
    let cancelled = false;
    getRedirectResult(auth)
      .then((result) => {
        if (!result || cancelled) return;
        setLoginError("");
      })
      .catch((error) => {
        if (!cancelled) setLoginError(authErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function loginWithGoogle() {
    if (authBusy) return;
    setAuthBusy(true);
    setLoginError("");

    try {
      await setPersistence(auth, browserLocalPersistence);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      if (shouldUseRedirectGoogleLogin()) {
        await signInWithRedirect(auth, provider);
        return;
      }

      const credential = await signInWithPopup(auth, provider);
      const user = credential.user;
      const uid = user.uid;
      const email = normalizeEmail(user.email || "");
      const displayName = user.displayName || email.split("@")[0] || "Player";
      const profile = await loadUserProfile(uid);
      const existingLocal = players.find((item) => item.id === uid || normalizeEmail(item.email) === email);

      const player = {
        ...firebaseProfileToPlayer(uid, profile || existingLocal || {}, email),
        username: profile?.username || existingLocal?.username || displayName.toLowerCase().replace(/\s+/g, "") || email.split("@")[0] || "player",
        name: profile?.name || existingLocal?.name || displayName,
        email,
        color: profile?.color || existingLocal?.color || playerColors.find((color) => !players.some((item) => item.color === color)) || playerColors[0],
        plan: normalizePlan(profile?.plan || existingLocal?.plan || "free"),
        campaignIds: profile?.campaignIds || existingLocal?.campaignIds || (activeCampaign?.id ? [activeCampaign.id] : []),
        campaignCharacterNames: profile?.campaignCharacterNames || existingLocal?.campaignCharacterNames || (activeCampaign?.id ? { [activeCampaign.id]: "" } : {})
      };

      if (!profile) {
        await saveUserProfile(uid, player);
      }

      setPlayers((current) => {
        const withoutDuplicate = current.filter((item) => item.id !== uid && normalizeEmail(item.email) !== email);
        return [...withoutDuplicate, player];
      });

      setPlan(normalizePlan(player.plan || "free"));
      setCurrentUserId(uid);
      setActivePlayerId(uid);
      if (player.campaignIds?.[0]) setActiveCampaignId(player.campaignIds[0]);
      setPage("calendar");
      setLoginError("");
    } catch (error) {
      setLoginError(authErrorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Firebase sign out failed:", error);
    }

    setCurrentUserId("");
    setActivePlayerId("");
    setLoginEmail("");
    setLoginPassword("");
    setLoginName("");
    setCampaignCharacterNames({});
    setStripeLoginVerifyUserId("");
  }

  async function persistPlan(nextPlan, nextBillingInterval = billingInterval, extraProfileFields = {}) {
    const safePlan = normalizePlan(nextPlan);
    const safeBillingInterval = safePlan === "free" ? "monthly" : normalizeBillingInterval(nextBillingInterval);

    if (!currentUser?.id || auth.currentUser?.uid !== currentUser.id) {
      throw new Error("Sign in again before changing your plan.");
    }

    const planPayload = {
      plan: safePlan,
      billingInterval: safeBillingInterval,
      ...extraProfileFields,
      updatedAt: new Date().toISOString()
    };

    saveCachedUserProfile(currentUser.id, planPayload);
    setPlan(safePlan);
    setBillingInterval(safeBillingInterval);
    setPlayers((current) => current.map((player) => player.id === currentUser?.id ? { ...player, plan: safePlan, billingInterval: safeBillingInterval, ...extraProfileFields } : player));

    await saveUserProfileRequired(currentUser.id, planPayload);
  }

  async function startPlanCheckout(planId) {
    if (planId === "free") {
      try {
        await persistPlan("free", "monthly");
        setSelectedPaymentPlan("");
        setSelectedBillingInterval("monthly");
        setBillingMessage("Free plan selected.");
      } catch (error) {
        setBillingMessage(profileSaveErrorMessage(error));
      }
      return;
    }

    setSelectedPaymentPlan(planId);
    setSelectedBillingInterval(planId === plan ? billingInterval : "monthly");
    setPaymentName(currentUser?.name ?? "");
    setPaymentEmail(currentUser?.email ?? "");
    setBillingMessage("");
  }


  const stripePaymentLinks = {
    adventurer: {
      monthly: "https://buy.stripe.com/3cI9ATfnI69nayf91I6Ri07",
      yearly: "https://buy.stripe.com/bJe28r1wS55jdKr4Ls6Ri06"
    },
    guildmaster: {
      monthly: "https://buy.stripe.com/6oU28r8Zk41fayffq66Ri05",
      yearly: "https://buy.stripe.com/28E9AT8ZkeFT0XF5Pw6Ri04"
    }
  };

  function getStripePaymentLink(planId, interval = selectedBillingInterval) {
    const safePlan = normalizePlan(planId);
    const safeInterval = normalizeBillingInterval(interval);
    return stripePaymentLinks[safePlan]?.[safeInterval] || "";
  }

  function rememberPendingStripePlan(planId, interval) {
    const pendingCheckoutPlan = {
      uid: currentUser?.id || auth.currentUser?.uid || "",
      plan: normalizePlan(planId),
      billingInterval: normalizeBillingInterval(interval),
      startedAt: new Date().toISOString()
    };

    setPendingStripeActivation(pendingCheckoutPlan);

    if (pendingCheckoutPlan.uid && pendingCheckoutPlan.plan !== "free") {
      saveUserProfile(pendingCheckoutPlan.uid, {
        pendingStripePlan: pendingCheckoutPlan.plan,
        pendingStripeBillingInterval: pendingCheckoutPlan.billingInterval,
        pendingStripeStartedAt: pendingCheckoutPlan.startedAt,
        updatedAt: new Date().toISOString()
      }).catch((error) => console.warn("Could not save pending Stripe plan to Firestore before redirect:", error));
    }

    setPlayers((current) => current.map((player) => player.id === pendingCheckoutPlan.uid ? {
      ...player,
      pendingStripePlan: pendingCheckoutPlan.plan,
      pendingStripeBillingInterval: pendingCheckoutPlan.billingInterval,
      pendingStripeStartedAt: pendingCheckoutPlan.startedAt
    } : player));

    return pendingCheckoutPlan;
  }

  async function verifyStripeSubscriptionByEmail(source = "manual_stripe_email_verification") {
    if (!currentUser || auth.currentUser?.uid !== currentUser.id) {
      setBillingMessage("Sign in before verifying your Stripe subscription.");
      return;
    }

    const automaticLoginCheck = source === "automatic_login_subscription_check";
    const email = normalizeEmail(automaticLoginCheck
      ? (currentUser.email || auth.currentUser?.email || accountEmail || paymentEmail || "")
      : (paymentEmail || accountEmail || currentUser.email || auth.currentUser?.email || "")
    );
    if (!email) {
      if (!automaticLoginCheck) setBillingMessage("Enter the same billing email used in Stripe, then try verification again.");
      return;
    }

    setStripeVerifyLoading(true);
    if (!automaticLoginCheck) {
      setBillingMessage("Checking Stripe subscription for " + email + "...");
    }

    try {
      const pendingForVerification = readPendingStripePlan();
      const expectedPlan = normalizePlan(selectedPaymentPlan || pendingForVerification?.plan || currentUser?.pendingStripePlan || plan || "free");
      const expectedBillingInterval = normalizeBillingInterval(selectedBillingInterval || pendingForVerification?.billingInterval || currentUser?.pendingStripeBillingInterval || billingInterval || "monthly");
      const statusUrl = new URL("/api/stripe-subscription-status", window.location.origin);
      statusUrl.searchParams.set("email", email);
      if (expectedPlan !== "free") statusUrl.searchParams.set("expectedPlan", expectedPlan);
      statusUrl.searchParams.set("expectedBillingInterval", expectedBillingInterval);

      const controller = new AbortController();
      const verifyTimeout = setTimeout(() => controller.abort(), automaticLoginCheck ? 5000 : 9000);
      let response;
      try {
        response = await fetch(statusUrl.toString(), { signal: controller.signal });
      } finally {
        clearTimeout(verifyTimeout);
      }
      const contentType = response.headers.get("content-type") || "";

      if (!contentType.includes("application/json")) {
        throw new Error("Stripe verification API did not return JSON. Check that /api/stripe-subscription-status is deployed and Vercel is not rewriting /api routes to the web app.");
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Stripe subscription verification failed.");

      if (!data.active || normalizePlan(data.plan) === "free") {
        if (!automaticLoginCheck) {
          setBillingMessage(data.message || "No active paid Stripe subscription was found for that email. Make sure the Stripe billing email matches this Dungeon Calendar account email.");
        }
        return;
      }

      const verifiedPlan = normalizePlan(data.plan);
      const verifiedInterval = normalizeBillingInterval(data.billingInterval || "monthly");

      await persistPlan(verifiedPlan, verifiedInterval, {
        pendingStripePlan: "free",
        pendingStripeBillingInterval: "monthly",
        pendingStripeStartedAt: "",
        stripeSubscriptionId: data.subscriptionId || "",
        stripeCustomerId: data.customerId || "",
        stripeVerifiedEmail: email,
        stripeVerifiedAt: new Date().toISOString(),
        stripeActivationSource: source
      });

      setPendingStripeActivation(null);
      setSelectedPaymentPlan("");
      if (!automaticLoginCheck) {
        setBillingMessage(`${planLimits[verifiedPlan]?.name || "Paid"} plan verified from Stripe and activated. Billing: ${verifiedInterval}.`);
      }
    } catch (error) {
      console.error("Stripe subscription verification failed:", error);
      if (!automaticLoginCheck) {
        if (error?.name === "AbortError") {
          setBillingMessage("Stripe verification is taking too long. Confirm the billing email is correct, then try again in a moment.");
        } else {
          setBillingMessage(profileSaveErrorMessage(error) || error.message || "Could not verify Stripe subscription. Make sure STRIPE_SECRET_KEY is set in Vercel.");
        }
      }
    } finally {
      setStripeVerifyLoading(false);
      setCheckoutLoading(false);
    }
  }

  async function completePayment() {
    if (!selectedPaymentPlan || checkoutLoading) return;

    const activatedPlan = normalizePlan(selectedPaymentPlan);
    const activatedInterval = normalizeBillingInterval(selectedBillingInterval);

    if (activatedPlan === "free") {
      try {
        await persistPlan("free", "monthly");
        setSelectedPaymentPlan("");
        setBillingMessage("Free plan selected.");
      } catch (error) {
        setBillingMessage(profileSaveErrorMessage(error));
      }
      return;
    }

    const paymentLink = getStripePaymentLink(activatedPlan, activatedInterval);

    if (!paymentLink) {
      setBillingMessage("No Stripe payment link is configured for that plan and billing cycle.");
      return;
    }

    setCheckoutLoading(true);
    setBillingMessage("Opening Stripe Checkout...");

    try {
      const checkoutUrl = new URL(paymentLink);
      const email = paymentEmail.trim() || currentUser?.email || auth.currentUser?.email || "";
      if (email) checkoutUrl.searchParams.set("prefilled_email", email);
      checkoutUrl.searchParams.set("client_reference_id", currentUser?.id || auth.currentUser?.uid || "guest");
      checkoutUrl.searchParams.set("stripe_plan", activatedPlan);
      checkoutUrl.searchParams.set("stripe_billing", activatedInterval);
      checkoutUrl.searchParams.set("stripe_success", "true");
      checkoutUrl.searchParams.set("success_url", `${window.location.origin}/subscription-complete?stripe_success=true&stripe_plan=${encodeURIComponent(activatedPlan)}&stripe_billing=${encodeURIComponent(activatedInterval)}`);
      rememberPendingStripePlan(activatedPlan, activatedInterval);

      if (typeof window !== "undefined") {
        window.location.assign(checkoutUrl.toString());
      }
    } catch (error) {
      setCheckoutLoading(false);
      setBillingMessage(error.message || "Unable to open Stripe Checkout.");
    }
  }

  async function cancelCurrentPlan() {
    if (plan === "free") {
      setAccountMessage("You are already on the Free plan.");
      return;
    }

    const confirmed = window.confirm("Cancel your current paid membership and switch to the Free plan?");
    if (!confirmed) return;

    try {
      await persistPlan("free", "monthly");
      setSelectedPaymentPlan("");
      setBillingMessage("Membership cancelled. Free plan is now active.");
      setAccountMessage("Membership cancelled. You are now on the Free plan.");
    } catch (error) {
      const message = profileSaveErrorMessage(error);
      setBillingMessage(message);
      setAccountMessage(message);
    }
  }

  function ownedCampaignsForUser(userId = currentUser?.id) {
    if (!userId) return [];
    return campaigns.filter((campaign) =>
      campaign.ownerId === userId ||
      (!campaign.ownerId && (campaign.dungeonMasterIds ?? []).includes(userId))
    );
  }

  function canUseMoreCampaigns() {
    const limit = planLimits[plan]?.campaigns ?? 1;
    if (limit === Infinity) return true;
    return ownedCampaignsForUser().length < limit;
  }

  function canUseMoreCharacters() {
    return !!currentUser;
  }

  function addCampaign() {
    if (!currentUser) return;

    if (!canUseMoreCampaigns()) {
      setBillingMessage("Your created campaign limit has been reached. Invited campaigns are free, but creating more campaigns requires an upgraded plan.");
      setPage("billing");
      return;
    }
    const campaign = normalizeCampaignForSync({ ...createCampaign("", [currentUser.id], currentUser.id), memberIds: [currentUser.id] });
    setCampaigns((current) => [...current, campaign]);
    saveCampaignToFirestore(campaign);
    setPlayers((current) => current.map((player) => {
      if (player.id !== currentUser.id) return player;
      const existingCampaignIds = player.campaignIds ?? [];
      return {
        ...player,
        campaignIds: existingCampaignIds.includes(campaign.id) ? existingCampaignIds : [...existingCampaignIds, campaign.id]
      };
    }));
    setActiveCampaignId(campaign.id);
    setPage("settings");
  }

  function joinCampaign(campaignId) {
    if (!currentUser) return;

    setPlayers((current) => current.map((player) => {
      if (player.id !== currentUser.id) return player;
      const existingCampaignIds = player.campaignIds ?? [];
      return existingCampaignIds.includes(campaignId)
        ? player
        : { ...player, campaignIds: [...existingCampaignIds, campaignId] };
    }));
    setActiveCampaignId(campaignId);
  }

  function setCampaignRoleForCurrentUser(campaignId, role) {
    if (!currentUser) return;

    joinCampaign(campaignId);

    if (role === "Dungeon Master") {
      setPlayers((current) => current.map((player) => player.id === currentUser.id ? {
        ...player,
        color: "bg-red-600"
      } : player));
    }
    setCampaigns((current) => current.map((campaign) => {
      if (campaign.id !== campaignId) return campaign;
      const currentDmIds = campaign.dungeonMasterIds ?? [];
      return role === "Dungeon Master"
        ? {
            ...campaign,
            dungeonMasterIds: currentDmIds.includes(currentUser.id) ? currentDmIds : [...currentDmIds, currentUser.id]
          }
        : {
            ...campaign,
            dungeonMasterIds: currentDmIds.filter((id) => id !== currentUser.id)
          };
    }));
  }

  function leaveCampaign(campaignId) {
    if (!currentUser) return;

    const nextCharacterNames = { ...(currentUser.campaignCharacterNames || {}) };
    delete nextCharacterNames[campaignId];

    const nextTokenImages = { ...(currentUser.campaignTokenImages || {}) };
    delete nextTokenImages[campaignId];

    const updatedUser = {
      ...currentUser,
      campaignIds: (currentUser.campaignIds ?? []).filter((id) => id !== campaignId),
      campaignCharacterNames: nextCharacterNames,
      campaignTokenImages: nextTokenImages,
      lockedColorCampaignIds: (currentUser.lockedColorCampaignIds ?? []).filter((id) => id !== campaignId)
    };

    setPlayers((current) => current.map((player) => player.id === currentUser.id ? updatedUser : player));

    setCampaigns((current) => current.map((campaign) => {
      if (campaign.id !== campaignId) return campaign;
      const removeId = (ids = []) => ids.filter((id) => id !== currentUser.id);
      const removeFromDateMap = (dateMap = {}) => Object.fromEntries(
        Object.entries(dateMap).map(([key, ids]) => [key, removeId(ids)])
      );

      return {
        ...campaign,
        ownerId: campaign.ownerId === currentUser.id ? "" : campaign.ownerId,
        dungeonMasterIds: removeId(campaign.dungeonMasterIds),
        availability: removeFromDateMap(campaign.availability),
        unavailable: removeFromDateMap(campaign.unavailable)
      };
    }));

    if (auth.currentUser?.uid === currentUser.id) {
      saveUserProfile(currentUser.id, {
        role: updatedUser.role || "Player",
        username: updatedUser.username || "",
        name: updatedUser.name || "",
        email: normalizeEmail(updatedUser.email || ""),
        phone: updatedUser.phone || "",
        plan: normalizePlan(plan),
        campaignIds: updatedUser.campaignIds || [],
        campaignCharacterNames: updatedUser.campaignCharacterNames || {},
        lockedColorCampaignIds: updatedUser.lockedColorCampaignIds || [],
        color: updatedUser.color || "",
        campaignTokenImages: updatedUser.campaignTokenImages || {}
      });
    }

    const nextCampaign = visibleCampaigns.find((campaign) => campaign.id !== campaignId);
    setActiveCampaignId(nextCampaign?.id || "");
  }

  function addPlayer() {
    const trimmed = newPlayer.trim();
    if (!trimmed || !isDungeonMaster || !activeCampaign?.id) return;

    const trimmedEmail = normalizeEmail(newPlayerEmail);
    const duplicate = activeCampaignPlayers.some((player) =>
      player.name?.toLowerCase() === trimmed.toLowerCase() ||
      (!!trimmedEmail && normalizeEmail(player.email || "") === trimmedEmail)
    );
    if (duplicate) return;

    const existingByEmail = trimmedEmail ? players.find((player) => normalizeEmail(player.email || "") === trimmedEmail) : null;
    const player = campaignPlayerRecord({
      ...(existingByEmail || {}),
      id: existingByEmail?.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      role: "Player",
      name: trimmed,
      email: trimmedEmail,
      password: "dndplayer",
      phone: newPlayerPhone.trim(),
      color: existingByEmail?.color || playerColors[players.length % playerColors.length]
    }, activeCampaign.id);

    setPlayers((current) => {
      const key = playerIdentityKey(player);
      const withoutDuplicate = current.filter((item) => item.id !== player.id && playerIdentityKey(item) !== key);
      return [...withoutDuplicate, player];
    });

    setCampaigns((current) => current.map((campaign) => {
      if (campaign.id !== activeCampaign.id) return campaign;
      const nextCampaign = upsertCampaignPlayer(campaign, player);
      saveCampaignToFirestore(nextCampaign);
      return nextCampaign;
    }));

    setNewPlayer("");
    setNewPlayerEmail("");
    setNewPlayerPhone("");
  }

  function updatePlayerColor(color) {
    if (!currentUser) return;

    if (activeCampaign?.dungeonMasterIds?.includes(currentUser.id)) {
      color = "bg-red-600";
    }

    const colorUsed = players.some((player) =>
      player.id !== currentUser.id &&
      player.color === color &&
      (player.campaignIds ?? []).includes(activeCampaign?.id)
    );

    if (colorUsed) return;

    setPlayers((current) => current.map((player) => {
      if (player.id !== currentUser.id) return player;

      const lockedCampaignIds = player.lockedColorCampaignIds ?? [];

      return {
        ...player,
        color: activeCampaign?.dungeonMasterIds?.includes(currentUser.id)
          ? "bg-red-600"
          : color,
        lockedColorCampaignIds: activeCampaign?.id && !lockedCampaignIds.includes(activeCampaign.id)
          ? [...lockedCampaignIds, activeCampaign.id]
          : lockedCampaignIds
      };
    }));
  }

  function userUsesPasswordLogin() {
    return !!auth.currentUser?.providerData?.some((provider) => provider.providerId === "password");
  }

  function resetPasswordChangeForm(message = "") {
    setShowPasswordVerify(false);
    setPasswordVerified(false);
    setCurrentPasswordInput("");
    setNewPasswordInput("");
    setConfirmPasswordInput("");
    setShowCurrentPasswordText(false);
    setShowNewPasswordText(false);
    setShowConfirmPasswordText(false);
    setAccountPassword("");
    if (editingField === "password") setEditingField("");
    if (message) setAccountMessage(message);
  }

  async function verifyCurrentPassword(event) {
    if (event?.preventDefault) event.preventDefault();
    if (!auth.currentUser) {
      setAccountMessage("Sign in again before changing your password.");
      return;
    }

    if (!userUsesPasswordLogin()) {
      resetPasswordChangeForm("This account signs in with Google. Change the password from your Google account settings.");
      return;
    }

    if (!auth.currentUser.email) {
      setAccountMessage("Your account does not have an email/password login to verify.");
      return;
    }

    if (!currentPasswordInput.trim()) {
      setAccountMessage("Enter your current password.");
      return;
    }

    try {
      setIsSavingAccount(true);
      setAccountMessage("Verifying current password...");
      const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPasswordInput);
      await reauthenticateWithCredential(auth.currentUser, credential);
      setPasswordVerified(true);
      setShowPasswordVerify(false);
      setShowCurrentPasswordText(false);
      setCurrentPasswordInput("");
      setNewPasswordInput("");
      setConfirmPasswordInput("");
      setEditingField("");
      setAccountMessage("Password verified. Enter and confirm your new password.");
    } catch (error) {
      setPasswordVerified(false);
      setAccountMessage("Current password is incorrect.");
    } finally {
      setIsSavingAccount(false);
    }
  }

  async function savePasswordChange(event) {
    if (event?.preventDefault) event.preventDefault();
    if (isSavingAccount) return;

    if (!auth.currentUser) {
      setAccountMessage("Sign in again before changing your password.");
      return;
    }

    if (!passwordVerified) {
      setAccountMessage("Verify your current password first.");
      return;
    }

    if (!newPasswordInput.trim()) {
      setAccountMessage("Enter a new password.");
      return;
    }

    if (newPasswordInput.length < 6) {
      setAccountMessage("New password must be at least 6 characters.");
      return;
    }

    if (newPasswordInput !== confirmPasswordInput) {
      setAccountMessage("New passwords do not match.");
      return;
    }

    try {
      setIsSavingAccount(true);
      setAccountMessage("Changing password...");
      await updatePassword(auth.currentUser, newPasswordInput);
      resetPasswordChangeForm("Password changed successfully.");
    } catch (error) {
      const code = error?.code || "";
      if (code === "auth/requires-recent-login") {
        setPasswordVerified(false);
        setShowPasswordVerify(true);
        setAccountMessage("For security, verify your current password again before changing it.");
        return;
      }
      if (code === "auth/weak-password") {
        setAccountMessage("New password must be at least 6 characters.");
        return;
      }
      console.error("Password change failed:", error);
      setAccountMessage(error?.message || "Password change failed.");
    } finally {
      setIsSavingAccount(false);
    }
  }

  async function saveAccountSettings(event) {
    if (event?.preventDefault) event.preventDefault();
    if (isSavingAccount) return;
    if (!currentUser || !auth.currentUser) {
      setAccountMessage("Sign in again before saving account settings.");
      return;
    }

    const nextUsername = accountUsername.trim() || currentUser.username || currentUser.name || "player";
    const nextName = accountName.trim() || currentUser.name || accountUsername.trim() || "Player";
    const currentAuthEmail = normalizeEmail(auth.currentUser?.email || "");
    const existingEmail = normalizeEmail(currentUser.email || currentAuthEmail || "");
    const nextEmail = normalizeEmail(accountEmail || existingEmail);
    const emailChanged = !!nextEmail && nextEmail !== currentAuthEmail && nextEmail !== existingEmail;

    if (!nextUsername || !nextName) {
      setAccountMessage("Username and name are required.");
      return;
    }

    if (nextEmail) {
      const emailUsed = players.some((player) => player.id !== currentUser.id && normalizeEmail(player.email) === nextEmail);
      if (emailUsed) {
        setAccountMessage("That email is already used by another account.");
        return;
      }
    }

    try {
      setIsSavingAccount(true);
      setAccountMessage("Saving account settings...");
      if (auth.currentUser && editingField === "email" && nextEmail && nextEmail !== currentAuthEmail) {
        if (!userUsesPasswordLogin()) {
          setAccountMessage("This account signs in with Google. Change the login email from your Google account settings.");
          return;
        }
        await updateEmail(auth.currentUser, nextEmail);
      }

      const updatedProfile = {
        ...currentUser,
        username: nextUsername,
        name: nextName,
        phone: accountPhone.trim(),
        email: nextEmail || existingEmail,
        plan: normalizePlan(plan),
        billingInterval: normalizeBillingInterval(billingInterval),
        password: ""
      };

      const profileUpdatePayload = {
        role: updatedProfile.role || "Player",
        username: updatedProfile.username || "",
        name: updatedProfile.name || "",
        email: normalizeEmail(updatedProfile.email || ""),
        phone: updatedProfile.phone || "",
        plan: normalizePlan(plan),
        billingInterval: normalizeBillingInterval(billingInterval),
        campaignIds: updatedProfile.campaignIds || [],
        campaignCharacterNames: updatedProfile.campaignCharacterNames || {},
        lockedColorCampaignIds: updatedProfile.lockedColorCampaignIds || [],
        color: updatedProfile.color || "",
        campaignTokenImages: updatedProfile.campaignTokenImages || {},
        updatedAt: new Date().toISOString()
      };

      saveCachedUserProfile(currentUser.id, profileUpdatePayload);
      setPlayers((current) => current.map((player) => player.id === currentUser.id ? updatedProfile : player));
      setAccountUsername(updatedProfile.username || "");
      setAccountName(updatedProfile.name || "");
      setAccountPhone(updatedProfile.phone || "");
      setAccountEmail(updatedProfile.email || "");
      setEditingField("");
      setAccountPassword("");
      setAccountMessage("Account settings saved.");

      saveUserProfileQuick(currentUser.id, profileUpdatePayload).catch((error) => {
        console.error("Background profile save failed:", error);
        setAccountMessage(profileSaveErrorMessage(error));
      });
    } catch (error) {
      const code = error?.code || "";
      if (code === "auth/requires-recent-login") {
        setShowPasswordVerify(true);
        setEditingField("");
        setAccountMessage("For security, enter your current password before changing your email or password.");
        return;
      }
      if (code === "auth/weak-password") {
        setAccountMessage("New password must be at least 6 characters.");
        return;
      }
      if (code === "auth/email-already-in-use") {
        setAccountMessage("That email is already used by another account.");
        return;
      }
      if (code === "auth/provider-already-linked" || code === "auth/operation-not-allowed") {
        setAccountMessage("This account provider does not allow that change from Dungeon Calendar.");
        return;
      }
      console.error("Account settings save failed:", error);
      setAccountMessage(profileSaveErrorMessage(error));
    } finally {
      setIsSavingAccount(false);
    }
  }

  function deleteCurrentAccount() {
    if (!currentUser) return;

    if (campaigns.some((campaign) => campaign.dungeonMasterIds?.includes(currentUser.id))) {
      setAccountMessage("Accounts that are Dungeon Master for a campaign cannot be deleted until that role is removed.");
      return;
    }

    if (deleteConfirmText !== "DELETE") {
      setAccountMessage("Type DELETE to confirm account removal.");
      return;
    }

    removePlayer(currentUser.id);
    setShowDeleteConfirm(false);
    setDeleteConfirmText("");
    logout();
  }

  function removePlayer(id) {
    if (!isDungeonMaster || !activeCampaign?.id) return;
    const removedPlayer = activeCampaignPlayers.find((player) => player.id === id) || players.find((player) => player.id === id);
    const removedEmail = normalizeEmail(removedPlayer?.email || "");

    setPlayers((current) => current.map((player) => {
      if (player.id !== id && (!removedEmail || normalizeEmail(player.email || "") !== removedEmail)) return player;
      const nextCampaignIds = (player.campaignIds || []).filter((campaignId) => campaignId !== activeCampaign.id);
      const nextCharacterNames = { ...(player.campaignCharacterNames || {}) };
      const nextTokenImages = { ...(player.campaignTokenImages || {}) };
      delete nextCharacterNames[activeCampaign.id];
      delete nextTokenImages[activeCampaign.id];
      return {
        ...player,
        campaignIds: nextCampaignIds,
        campaignCharacterNames: nextCharacterNames,
        campaignTokenImages: nextTokenImages
      };
    }));

    setCampaigns((current) => current.map((campaign) => {
      if (campaign.id !== activeCampaign.id) return campaign;
      const nextCampaign = removeCampaignPlayer(campaign, removedPlayer || { id, email: removedEmail });
      saveCampaignToFirestore(nextCampaign);
      return nextCampaign;
    }));
  }

  function toggleAvailability(date) {
    if (!activePlayer || !activeCampaign) return;
    const key = dateKey(date);
    const dungeonMasterAvailableForDate = (activeCampaign.availability[key] ?? []).some((id) => activeCampaign.dungeonMasterIds?.includes(id));

    if (!isDungeonMaster && !dungeonMasterAvailableForDate) {
      return;
    }

    updateActiveCampaign((campaign) => {
      const availableList = campaign.availability[key] ?? [];
      const unavailableList = campaign.unavailable?.[key] ?? [];

      const isAvailable = availableList.includes(activePlayer.id);
      const isUnavailable = unavailableList.includes(activePlayer.id);

      if (availabilityMode === "available") {
        const manualDates = new Set(campaign.manuallySelectedDates || []);
        if (isDungeonMaster) {
          if (isAvailable) manualDates.delete(key);
          else manualDates.add(key);
        }
        return {
          manuallySelectedDates: Array.from(manualDates),
          availability: {
            ...campaign.availability,
            [key]: isAvailable
              ? availableList.filter((id) => id !== activePlayer.id)
              : [...availableList, activePlayer.id]
          },
          unavailable: {
            ...campaign.unavailable,
            [key]: unavailableList.filter((id) => id !== activePlayer.id)
          }
        };
      }

      return {
        availability: {
          ...campaign.availability,
          [key]: availableList.filter((id) => id !== activePlayer.id)
        },
        unavailable: {
          ...campaign.unavailable,
          [key]: isUnavailable
            ? unavailableList.filter((id) => id !== activePlayer.id)
            : [...unavailableList, activePlayer.id]
        }
      };
    });
  }

  function chooseFinalDate(key) {
    if (isDungeonMaster) updateActiveCampaign(() => ({ chosenDate: key }));
  }

  function clearFinalDate() {
    if (isDungeonMaster) updateActiveCampaign(() => ({ chosenDate: "" }));
  }

  function generateRecurringSessions() {
    if (!isDungeonMaster || !chosenDate) return;
    const dates = buildGeneratedSessionDates(chosenDate, recurringCadence, recurringSessionCount);
    updateActiveCampaign(() => ({
      generatedSessionDates: dates,
      recurringCadence,
      recurringSessionCount: Number(recurringSessionCount) || 0
    }));
  }

  function removeGeneratedSessions() {
    if (!isDungeonMaster) return;
    updateActiveCampaign((campaign) => {
      const generated = new Set(campaign.generatedSessionDates || []);
      const manual = new Set(campaign.manuallySelectedDates || []);
      const nextAvailability = { ...(campaign.availability || {}) };
      const nextUnavailable = { ...(campaign.unavailable || {}) };
      generated.forEach((key) => {
        if (!manual.has(key) && campaign.chosenDate !== key) {
          delete nextAvailability[key];
          delete nextUnavailable[key];
        }
      });
      return { availability: nextAvailability, unavailable: nextUnavailable, generatedSessionDates: [] };
    });
  }

  function chooseBestDateAutomatically() {
    if (!isDungeonMaster) return;

    if (!hasPlanFeature("autoPick")) {
      setBillingMessage("Automatic best-date voting is available on Adventurer and Guildmaster plans.");
      setPage("billing");
      return;
    }

    const eligibleDates = Object.entries(availability)
      .filter(([key]) => !isGeneratedOnlyDate(activeCampaign, key))
      .map(([key, ids]) => {
        const dmAvailable = ids.some((id) => dungeonMasterIds.includes(id));
        const unavailableCount = unavailable[key]?.length ?? 0;
        return {
          key,
          availableCount: ids.length,
          unavailableCount,
          dmAvailable
        };
      })
      .filter((item) => item.dmAvailable && item.availableCount > 0)
      .sort((a, b) =>
        b.availableCount - a.availableCount ||
        a.unavailableCount - b.unavailableCount ||
        a.key.localeCompare(b.key)
      );

    if (eligibleDates[0]) {
      chooseFinalDate(eligibleDates[0].key);
    }
  }

  function getLoginLink(playerName = "") {
    const baseUrl = "https://dungeoncalendar.com";
    const params = new URLSearchParams({
      role: "Player",
      name: playerName,
      campaign: activeCampaign?.id || ""
    });

    return `${baseUrl}/?${params.toString()}`;
  }

  function getInviteMessage(playerName) {
    return `You have been invited to ${campaignName || "the campaign"}. Log in as ${playerName} and mark your Dungeon Calendar availability: ${getLoginLink(playerName)}`;
  }

  function getInviteEmailSubject() {
    return `${campaignName || "Dungeon Calendar"} scheduling invite`;
  }

  function openEmailInvitePopup(player) {
    setEmailInvitePlayer(player);
    setEmailInviteCopied(false);
    setEmailInviteMessage("");
  }

  function closeEmailInvitePopup() {
    setEmailInvitePlayer(null);
    setEmailInviteCopied(false);
    setEmailInviteMessage("");
  }

  async function copyEmailInviteText() {
    if (!emailInvitePlayer) return;

    const inviteText = [
      `To: ${emailInvitePlayer.email || ""}`,
      `Subject: ${getInviteEmailSubject()}`,
      "",
      getInviteMessage(emailInvitePlayer.name)
    ].join("\n");

    try {
      await navigator.clipboard.writeText(inviteText);
      setEmailInviteCopied(true);
      setEmailInviteMessage("Invite email copied. Your Dungeon Calendar page stayed open.");
    } catch {
      setEmailInviteCopied(false);
      setEmailInviteMessage("Copy was blocked by the browser. You can manually select the text below.");
    }
  }

  function openInviteEmailClient() {
    if (!emailInvitePlayer?.email) return;

    const mailtoUrl = `mailto:${emailInvitePlayer.email}?subject=${encodeURIComponent(getInviteEmailSubject())}&body=${encodeURIComponent(getInviteMessage(emailInvitePlayer.name))}`;
    const opened = window.open(mailtoUrl, "_blank", "noopener,noreferrer");

    if (opened) {
      setEmailInviteMessage("Your email app should open in a separate window/tab. This page will stay open.");
    } else {
      setEmailInviteMessage("Popup was blocked. Use Copy Invite Email, or allow popups for dungeoncalendar.com.");
    }
  }

  function formatCalendarDate(date) {
    return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  }

  function buildCalendarEvent() {
    if (!chosenDate) return null;
    const start = new Date(`${chosenDate}T${sessionTime}:00`);
    const end = new Date(start);
    end.setHours(end.getHours() + Number(sessionDuration));
    const title = `${campaignName || "Dungeon Calendar"} Session`;
    const details = `Final session date chosen by the Dungeon Master. Reminder set for ${reminderHours} hour(s) before the session.`;
    const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${formatCalendarDate(start)}/${formatCalendarDate(end)}&details=${encodeURIComponent(details)}`;
    const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(title)}&startdt=${encodeURIComponent(start.toISOString())}&enddt=${encodeURIComponent(end.toISOString())}&body=${encodeURIComponent(details)}`;
    const icsContent = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `DTSTART:${formatCalendarDate(start)}`, `DTEND:${formatCalendarDate(end)}`, `SUMMARY:${title}`, `DESCRIPTION:${details}`, "BEGIN:VALARM", `TRIGGER:-PT${reminderHours}H`, "ACTION:DISPLAY", "DESCRIPTION:Your Dungeon Calendar session is coming up.", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\n");
    const icsBlob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const icsUrl = URL.createObjectURL(icsBlob);
    return { googleUrl, outlookUrl, icsUrl };
  }

  async function copyPartyInvite() {
    try {
      await navigator.clipboard.writeText(`Campaign: ${campaignName || "Campaign"}\nScheduling link: ${getLoginLink("")}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const calendarEvent = buildCalendarEvent();

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleLocationChange = () => setPublicRoute(window.location.pathname || "/");
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  function navigateTo(path) {
    if (typeof window === "undefined") return;
    window.history.pushState({}, "", path);
    setPublicRoute(path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText("https://dungeoncalendar.com");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }


  function LegalLinks({ className = "" } = {}) {
    return (
      <div className={classNames("flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-zinc-500", className)}>
        <a href="/privacy" className="underline-offset-4 hover:text-zinc-200 hover:underline">Privacy Policy</a>
        <span aria-hidden="true">•</span>
        <a href="/terms" className="underline-offset-4 hover:text-zinc-200 hover:underline">Terms of Service</a>
      </div>
    );
  }

  function AboutPage() {
    const shareUrl = "https://dungeoncalendar.com";
    const shareText = "Organize your D&D campaigns with Dungeon Calendar — schedule sessions, track availability, and invite your party.";
    const socialLinks = [
      { label: "Share on Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}` },
      { label: "Share on X", href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}` },
      { label: "Share on Reddit", href: `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent("Dungeon Calendar - D&D Campaign Scheduling")}` },
      { label: "Share on LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}` }
    ];
    const featureCards = [
      { title: "Campaign Management", text: "Create campaigns, invite players, assign Dungeon Masters, and keep every adventure organized in one place." },
      { title: "Session Scheduling", text: "Use a shared calendar to find dates that work for the whole party without endless group chats." },
      { title: "Availability Tracking", text: "Players can mark available or unavailable dates so Dungeon Masters can choose the best session time." },
      { title: "Player Invites", text: "Send campaign invite links by email or copy a ready-to-share message for your group chat." },
      { title: "Cross-Device Access", text: "Use Dungeon Calendar from desktop, tablet, or phone with the same Firebase account and profile." },
      { title: "Paid DM Tools", text: "Adventurer and Guildmaster plans unlock more campaign creation, calendar exports, tracking tools, and premium features." }
    ];

    return (
      <div className="relative min-h-screen overflow-x-hidden text-zinc-100">
        <AppBackground />
        <main className="relative z-10 mx-auto w-[95%] max-w-[1600px] px-3 py-6 sm:px-6 lg:px-8">
          <header className="rounded-3xl border border-red-900/60 bg-black/60 p-6 text-center shadow-2xl backdrop-blur sm:p-8">
            <button type="button" onClick={() => navigateTo("/")} className="mx-auto block">
              <DungeonCalendarLogo small />
            </button>
            <h1 className="mt-4 text-2xl font-black text-white sm:text-3xl">Dungeon Calendar</h1>
            <p className="mx-auto mt-2 max-w-2xl text-sm font-semibold uppercase tracking-[0.22em] text-red-300">
              D&D Campaign Scheduling & Session Planning
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button onClick={() => navigateTo("/")} variant="ghost" className="rounded-xl border border-zinc-700 hover:bg-zinc-900">Log In</Button>
              <Button onClick={() => navigateTo("/")} className="rounded-xl bg-red-700 hover:bg-red-600">Create Free Account</Button>
            </div>
            <LegalLinks className="mt-5" />
          </header>

          <section className="mt-6 grid auto-rows-fr gap-6 lg:grid-cols-2">
            <div className="flex h-full flex-col rounded-3xl border border-zinc-700 bg-black/60 p-6 shadow-2xl backdrop-blur sm:p-8 lg:p-10">
              <p className="text-sm font-bold uppercase tracking-[0.3em] text-red-300">About Dungeon Calendar</p>
              <h2 className="mt-4 text-4xl font-black leading-tight sm:text-5xl xl:text-6xl">Schedule tabletop RPG sessions without endless group chats.</h2>
              <p className="mt-5 max-w-4xl text-lg leading-8 text-zinc-300">
                Dungeon Calendar is a campaign scheduling and player management app built for Dungeons & Dragons, Pathfinder, and other tabletop RPG groups. Dungeon Masters can manage campaigns, collect player availability, invite party members, and choose final session dates from one organized calendar.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button onClick={() => navigateTo("/")} className="rounded-xl bg-red-700 px-5 py-3 hover:bg-red-600">Start Scheduling Free</Button>
                <Button onClick={copyShareLink} variant="ghost" className="rounded-xl border border-zinc-700 px-5 py-3 hover:bg-zinc-900">
                  <Copy className="mr-2 h-4 w-4" /> {copied ? "Copied!" : "Copy App Link"}
                </Button>
              </div>
            </div>

            <aside className="flex h-full flex-col rounded-3xl border border-amber-700/60 bg-amber-950/25 p-6 shadow-2xl backdrop-blur sm:p-8 lg:p-10">
              <h2 className="text-3xl font-black leading-tight text-amber-100 xl:text-4xl">Built for parties that actually want to play.</h2>
              <p className="mt-4 text-lg leading-8 text-zinc-300">Use Dungeon Calendar to reduce scheduling friction, organize player responses, and keep your next adventure moving.</p>
              <div className="mt-6 grid flex-1 gap-4 text-sm text-zinc-200">
                <div className="rounded-2xl border border-zinc-800 bg-black/35 p-5"><b>D&D scheduling</b><span className="mt-1 block text-zinc-400">Coordinate sessions with a visual campaign calendar.</span></div>
                <div className="rounded-2xl border border-zinc-800 bg-black/35 p-5"><b>Dungeon Master tools</b><span className="mt-1 block text-zinc-400">Manage campaigns, invites, players, and final dates.</span></div>
                <div className="rounded-2xl border border-zinc-800 bg-black/35 p-5"><b>Player availability</b><span className="mt-1 block text-zinc-400">Let everyone mark available and unavailable dates.</span></div>
              </div>
            </aside>
          </section>

          <section className="mt-6 rounded-3xl border border-zinc-700 bg-black/60 p-6 text-center shadow-2xl backdrop-blur sm:p-8">
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-red-300">Trusted Dungeon Master Tools</p>
            <h2 className="mx-auto mt-3 max-w-3xl text-3xl font-black">A shared scheduling hub for every adventure.</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
              {["Campaign Scheduling", "Availability Tracking", "Email Invites", "Cross-Device Access", "Firebase Security", "Stripe Billing"].map((item) => (
                <div key={item} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 font-bold text-zinc-100">{item}</div>
              ))}
            </div>
          </section>

          <section className="mt-6 rounded-3xl border border-zinc-700 bg-black/60 p-6 shadow-2xl backdrop-blur sm:p-8">
            <div className="mx-auto max-w-4xl text-center">
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-red-300">Features</p>
              <h2 className="mt-3 text-3xl font-black">Everything your campaign needs to plan the next session.</h2>
            </div>
            <div className="mt-6 grid auto-rows-fr gap-4 md:grid-cols-2 xl:grid-cols-3">
              {featureCards.map((feature) => (
                <article key={feature.title} className="flex h-full flex-col rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
                  <h3 className="text-xl font-bold text-white">{feature.title}</h3>
                  <p className="mt-3 flex-1 leading-7 text-zinc-400">{feature.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border border-zinc-700 bg-black/60 p-6 shadow-2xl backdrop-blur sm:p-8">
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-red-300">Who it is for</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {["Dungeon Masters", "D&D players", "Pathfinder groups", "Online campaigns", "In-person tables", "Tabletop RPG communities"].map((item) => (
                  <div key={item} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 font-semibold text-zinc-100">{item}</div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-700 bg-black/60 p-6 shadow-2xl backdrop-blur sm:p-8">
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-red-300">Share Dungeon Calendar</p>
              <p className="mt-3 text-zinc-300">Help other players and Dungeon Masters discover a better way to schedule tabletop RPG sessions.</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {socialLinks.map((link) => (
                  <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-center font-bold text-zinc-100 hover:border-red-600 hover:bg-red-950/40">{link.label}</a>
                ))}
              </div>
              <div className="mt-5 rounded-2xl border border-zinc-800 bg-black/40 p-4">
                <p className="text-xs uppercase tracking-widest text-zinc-500">Direct link</p>
                <p className="mt-2 break-all font-semibold text-amber-200">https://dungeoncalendar.com</p>
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-3xl border border-red-900/70 bg-gradient-to-r from-red-950/70 to-black/70 p-6 text-center shadow-2xl backdrop-blur sm:p-8">
            <h2 className="text-3xl font-black">Ready to start your next adventure?</h2>
            <p className="mx-auto mt-3 max-w-2xl text-zinc-300">Create a free account, invite your party, and find the best date for your next campaign session.</p>
            <Button onClick={() => navigateTo("/")} className="mt-6 rounded-xl bg-red-700 px-6 py-3 hover:bg-red-600">Create Your Free Account</Button>
            <LegalLinks className="mt-5" />
          </section>
        </main>
      </div>
    );
  }

  const Sidebar = (
    <aside className="w-full rounded-2xl border border-red-900/60 bg-black/55 p-4 shadow-[0_0_60px_rgba(0,0,0,0.7)] backdrop-blur-md sm:p-5">
      <DungeonCalendarLogo small />
      <div className="mt-5 text-center">
        <h1 className="text-2xl font-bold">Dungeon Calendar</h1>
        <p className="mt-2 text-sm text-zinc-300">Find a time for your next adventure.</p>
      </div>

      {currentUser && (
        <nav className="mt-5 grid grid-cols-2 gap-2 lg:mt-7 lg:block lg:space-y-2">
          {navItems.filter((item) => isDungeonMaster || (item.id !== "settings" && item.id !== "players")).map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => setPage(item.id)} className={classNames("flex w-full items-center justify-center gap-2 rounded-xl px-3 py-3 text-center text-sm transition lg:justify-start lg:gap-3 lg:px-4 lg:text-left lg:text-base", page === item.id ? "bg-red-900/60 text-white" : "text-zinc-300 hover:bg-zinc-900/80 hover:text-white")}>
                <Icon className="h-5 w-5" /> {item.label}
              </button>
            );
          })}
        </nav>
      )}

      <div className="my-7 h-px bg-zinc-800" />

      {!currentUser ? (
        <div className="space-y-5">
          <div className="text-center">
            <h2 className="text-2xl font-bold">{authMode === "login" ? "Welcome Back" : "Create Account"}</h2>
            <p className="mt-1 text-zinc-400">{authMode === "login" ? "Log in to your account" : "Create a new player account"}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-700 bg-black/40 p-1">
            <button
              onClick={() => {
                setAuthMode("login");
                setLoginError("");
              }}
              className={classNames("rounded-lg px-3 py-2 text-sm font-bold transition", authMode === "login" ? "bg-red-700 text-white" : "text-zinc-300 hover:bg-zinc-900")}
            >
              Log In
            </button>
            <button
              onClick={() => {
                setAuthMode("create");
                setLoginError("");
              }}
              className={classNames("rounded-lg px-3 py-2 text-sm font-bold transition", authMode === "create" ? "bg-red-700 text-white" : "text-zinc-300 hover:bg-zinc-900")}
            >
              Create Account
            </button>
          </div>
          <div>
            <label className="text-sm text-zinc-200">Email</label>
            <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} onKeyDown={(event) => event.key === "Enter" && login()} placeholder="Enter email" type="email" className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 outline-none ring-red-600/40 focus:ring-2" />
          </div>

          <div>
            <label className="text-sm text-zinc-200">Password</label>
            <input value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && login()} placeholder="Enter password" type="password" className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 outline-none ring-red-600/40 focus:ring-2" />
          </div>

          {authMode === "create" && (
            <div>
              <label className="text-sm text-zinc-200">Name</label>
            <input value={loginName} onChange={(event) => setLoginName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && login()} placeholder="Enter your name" className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 outline-none ring-red-600/40 focus:ring-2" />
            </div>
          )}
          {loginError && <p className="text-sm text-red-300">{loginError}</p>}

          <div className="flex items-center justify-between rounded-xl border border-zinc-700 bg-black/30 px-4 py-3">
            <label className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
                className="h-4 w-4 rounded border-zinc-600 bg-black text-red-600 focus:ring-red-500"
              />
              Remember Me
            </label>
          </div>

          <div className="flex justify-center rounded-xl border border-zinc-700 bg-black/30 px-2 py-3">
            <div ref={recaptchaContainerRef} />
          </div>

          <Button onClick={login} disabled={authBusy} className="w-full rounded-xl bg-gradient-to-r from-red-800 to-red-600 py-6 text-lg font-bold hover:from-red-700 hover:to-red-500">
            <LogIn className="mr-2 h-5 w-5" />
            {authBusy ? "Working..." : authMode === "login" ? "Log In" : "Create Account"}
          </Button>

          <Button onClick={loginWithGoogle} disabled={authBusy} variant="ghost" className="w-full rounded-xl border border-zinc-700 bg-white py-5 text-zinc-950 hover:bg-zinc-100">
            <span className="mr-2 text-lg font-black">G</span>
            {authBusy ? "Working..." : "Continue with Google"}
          </Button>

          <Button onClick={() => navigateTo("/about")} variant="ghost" className="w-full rounded-xl border border-zinc-700 py-4 text-zinc-100 hover:bg-zinc-900 hover:text-white">
            About Dungeon Calendar
          </Button>
          <LegalLinks />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
              <label className="text-sm text-zinc-400">Campaign</label>
              <select
                value={activeCampaign?.id ?? ""}
                onChange={(event) => joinCampaign(event.target.value)}
                className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/50 px-3 py-3 outline-none ring-red-600/40 focus:ring-2"
              >
                {visibleCampaigns.map((campaign, index) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name || `Campaign ${index + 1}`}
                  </option>
                ))}
              </select>
              <Button onClick={addCampaign} className="mt-3 w-full rounded-xl bg-red-700 hover:bg-red-600"><Plus className="mr-2 h-4 w-4" /> Add Campaign</Button>
            </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <p className="text-sm text-zinc-400">Logged in as</p>
            <p className="text-xl font-bold">{currentUser?.campaignCharacterNames?.[activeCampaign?.id] || currentUser?.name}</p>
            {currentUser.characterName && <p className="text-sm text-amber-300">Login Name: {currentUser.name}</p>}
            <p className="text-sm text-red-300">{activeCampaignRole}</p>
          </div>

          {!isDungeonMaster && (
            (currentUser.lockedColorCampaignIds ?? []).includes(activeCampaign?.id) ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <p className="text-sm font-semibold text-zinc-200">Player Color</p>
                <div className="mt-3 flex items-center gap-3">
                  <span className={classNames("h-8 w-8 rounded-full border-2 border-white", currentUser.color)} />
                  <span className="text-sm text-zinc-400">Color selected for this campaign.</span>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                <p className="text-sm font-semibold text-zinc-200">Choose Player Color</p>
                <p className="mt-1 text-xs text-zinc-500">Color locks after selection for this campaign.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {playerColors
                    .filter((color) => {
                      const usedByAnotherPlayer = players.some(
                        (player) =>
                          player.id !== currentUser.id &&
                          player.color === color &&
                          (player.campaignIds ?? []).includes(activeCampaign?.id)
                      );

                      return !usedByAnotherPlayer || currentUser.color === color;
                    })
                    .map((color) => {
                      const usedByAnotherPlayer = players.some((player) => player.id !== currentUser.id && player.color === color && (player.campaignIds ?? []).includes(activeCampaign?.id));
                      const isCurrentColor = currentUser.color === color;
                      return (
                        <button
                          key={color}
                          type="button"
                          disabled={usedByAnotherPlayer}
                          onClick={() => updatePlayerColor(color)}
                          title={usedByAnotherPlayer ? "Already chosen" : "Choose color"}
                          className={classNames(
                            "h-8 w-8 rounded-full border-2 transition",
                            color,
                            isCurrentColor ? "scale-110 border-white" : "border-transparent hover:border-zinc-300",
                            usedByAnotherPlayer && "cursor-not-allowed opacity-25"
                          )}
                        ></button>
                      );
                    })}
                </div>
              </div>
            )
          )}

          <Button onClick={() => setPage("account")} variant="ghost" className="w-full rounded-xl border border-zinc-700 py-5 text-zinc-100 hover:bg-zinc-900 hover:text-white">
            <Settings className="mr-2 h-4 w-4" /> User Settings
          </Button>

          <Button onClick={() => setPage("billing")} variant="ghost" className="w-full rounded-xl border border-zinc-700 py-5 text-zinc-100 hover:bg-zinc-900 hover:text-white">
            <Zap className="mr-2 h-4 w-4" />
            Plan: {plan === "guildmaster" ? "Guildmaster" : plan === "adventurer" ? "Adventurer" : "Free"}
          </Button>

          <Button onClick={() => navigateTo("/about")} variant="ghost" className="w-full rounded-xl border border-zinc-700 py-5 text-zinc-100 hover:bg-zinc-900 hover:text-white">About Dungeon Calendar</Button>

          <LegalLinks />

          <Button onClick={logout} variant="ghost" className="w-full rounded-xl border border-zinc-700 py-5 text-zinc-100 hover:bg-zinc-900 hover:text-white"><LogOut className="mr-2 h-4 w-4" /> Log Out</Button>
        </div>
      )}
    </aside>
  );

  const Header = (
    <div className="grid items-start gap-4 md:grid-cols-[1fr_auto]">
      <div>
        <h2 className="text-2xl font-bold leading-tight sm:text-4xl">
          {page === "dashboard" ? `Welcome back, ${currentUser?.username || currentUser?.campaignCharacterNames?.[activeCampaign?.id] || currentUser?.name || "Adventurer"}!` : page === "account" ? "Account Settings" : navItems.find((item) => item.id === page)?.label}
        </h2>
        <p className="mt-2 text-zinc-300">{campaignName || "Dungeon Calendar"}</p>
      </div>

      <div className="justify-self-start md:justify-self-end">
        <div className="rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 backdrop-blur">
          <span className="text-red-300 font-semibold">{activeCampaignRole === "Dungeon Master" ? "DM VIEW" : "PLAYER VIEW"}</span>
        </div>
      </div>
    </div>
  );

  function StatCards() {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur"><CardContent className="p-5"><CalendarCheck className="mb-3 h-8 w-8 text-red-400" /><p className="text-sm text-zinc-400">Next Session</p><p className="text-xl font-bold">{chosenDate ? selectedDateLabel : "TBD"}</p></CardContent></Card>
        <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur"><CardContent className="p-5"><Users className="mb-3 h-8 w-8 text-amber-400" /><p className="text-sm text-zinc-400">Players</p><p className="text-xl font-bold">{activeCampaignPlayers.length}</p></CardContent></Card>
        <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur"><CardContent className="p-5"><UserCheck className="mb-3 h-8 w-8 text-blue-400" /><p className="text-sm text-zinc-400">Dates Proposed</p><p className="text-xl font-bold">{Object.keys(availability).length}</p></CardContent></Card>
        <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur"><CardContent className="p-5"><Shield className="mb-3 h-8 w-8 text-emerald-400" /><p className="text-sm text-zinc-400">Campaign</p><p className="text-xl font-bold">{campaignName || "Unnamed"}</p></CardContent></Card>
      </div>
    );
  }

  function CalendarGrid({ compact = false } = {}) {
    return (
      <Card className="border-zinc-700 bg-black/55 text-zinc-100 shadow-2xl backdrop-blur">
        <CardContent className="p-3 sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex w-full items-center gap-2 sm:gap-4 md:w-auto">
              <Button variant="ghost" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="h-10 w-10 shrink-0 rounded-lg bg-zinc-900 hover:bg-zinc-800 hover:text-white sm:h-12 sm:w-12"><ChevronLeft /></Button>
              <div className="min-w-0 flex-1 text-center text-lg font-bold sm:min-w-52 sm:text-2xl">{monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}</div>
              <Button variant="ghost" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="h-10 w-10 shrink-0 rounded-lg bg-zinc-900 hover:bg-zinc-800 hover:text-white sm:h-12 sm:w-12"><ChevronRight /></Button>
            </div>
            <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
              <p className="w-full rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-300 sm:w-auto sm:px-4 sm:py-3">Marking as <span className="font-bold text-white">{activePlayer?.characterName || activePlayer?.name || currentUser?.campaignCharacterNames?.[activeCampaign?.id] || currentUser?.name}</span></p>

              {!isDungeonMaster && (
                <div className="flex overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950/90">
                  <button
                    onClick={() => setAvailabilityMode("available")}
                    className={classNames(
                      "px-4 py-3 text-sm font-bold transition",
                      availabilityMode === "available"
                        ? "bg-emerald-700 text-white"
                        : "text-zinc-300 hover:bg-zinc-800"
                    )}
                  >
                    Available
                  </button>
                  <button
                    onClick={() => setAvailabilityMode("unavailable")}
                    className={classNames(
                      "px-4 py-3 text-sm font-bold transition",
                      availabilityMode === "unavailable"
                        ? "bg-red-700 text-white"
                        : "text-zinc-300 hover:bg-zinc-800"
                    )}
                  >
                    Not Available
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="mt-5 overflow-hidden rounded-xl border border-zinc-800">
            <div className="grid grid-cols-7 bg-zinc-950/90">{dayNames.map((day) => <div key={day} className="px-1 py-3 text-center text-[11px] font-semibold text-zinc-400 sm:px-2 sm:py-4 sm:text-sm">{day}</div>)}</div>
            <div className="grid grid-cols-7">
              {dates.map((date) => {
                const key = dateKey(date);
                const generatedOnly = isGeneratedOnlyDate(activeCampaign, key);
                const showOnlyFinal = !!chosenDate && key !== chosenDate;
                const ids = (generatedOnly || showOnlyFinal) ? [] : (availability[key] ?? []);
                const hasDungeonMasterAvailable = ids.some((id) => isDungeonMasterResponse(id));
                const isChosenDate = key === chosenDate;
                const selectedByActive = ids.includes(activePlayerId);
                const unavailableIds = (generatedOnly || showOnlyFinal) ? [] : (unavailable[key] ?? []);
                const hasDungeonMasterUnavailable = unavailableIds.some((id) => isDungeonMasterResponse(id));
                const unavailableByActive = unavailableIds.includes(activePlayerId);
                const visibleAvailableIds = visibleResponseIds(ids);
                const visibleUnavailableIds = visibleResponseIds(unavailableIds);
                return (
                  <button
                    key={key}
                    disabled={!isDungeonMaster && !hasDungeonMasterAvailable}
                    onClick={() => toggleAvailability(date)}
                    className={classNames(
                      compact ? "min-h-14 p-1.5 sm:min-h-16 sm:p-2" : "min-h-16 p-1.5 sm:min-h-28 sm:p-4",
                      "border-r border-t border-zinc-800 text-left transition",
                      isDungeonMaster || hasDungeonMasterAvailable ? "hover:bg-zinc-900" : "cursor-not-allowed opacity-35",
                      date.getMonth() !== viewDate.getMonth() && "text-zinc-600",
                      dateVisualState({ ids, unavailableIds, selectedByActive, unavailableByActive, hasDungeonMasterAvailable, hasDungeonMasterUnavailable, isChosenDate, isDungeonMaster })
                    )}
                  >
                    <div className="flex items-start justify-between"><span className="font-semibold">{date.getDate()}</span>{(hasDungeonMasterAvailable || hasDungeonMasterUnavailable || isChosenDate) && <Shield className="h-4 w-4" />}</div>
                    {!compact && hasDungeonMasterAvailable && !isChosenDate && <div className="mt-4 hidden text-sm font-medium text-emerald-100 sm:block">DM available</div>}
                    {!compact && hasDungeonMasterUnavailable && !isChosenDate && <div className="mt-4 hidden text-sm font-medium text-red-100 sm:block">DM not available</div>}
                    {!compact && !isDungeonMaster && !hasDungeonMasterAvailable && !hasDungeonMasterUnavailable && <div className="mt-4 hidden text-xs font-semibold text-zinc-400 sm:block">Waiting for DM</div>}
                    {!compact && isChosenDate && <div className="mt-2 rounded-md bg-amber-300 px-1 py-1 text-center text-[10px] font-bold text-black sm:mt-4 sm:px-2 sm:text-xs">Final</div>}
                    {!compact && visibleUnavailableIds.length > 0 && <div className="mt-3 hidden space-y-1 sm:block">{visibleUnavailableIds.map((id) => { const player = players.find((p) => p.id === id); return player ? <div key={id} title={isDungeonMaster ? player.name : ""} className="flex items-center gap-1.5 rounded-md bg-red-950/60 px-1.5 py-1 text-[11px] font-semibold text-red-100"><PlayerToken player={player} campaignId={activeCampaign?.id} size="sm" className="h-4 w-4 border-amber-300" /><span className="truncate">{isDungeonMasterResponse(player.id) ? "DM not available" : isDungeonMaster ? `${player?.campaignCharacterNames?.[activeCampaign?.id] || player?.name} unavailable` : "You unavailable"}</span></div> : null; })}</div>}
                    {!compact && visibleAvailableIds.length > 0 && <div className="mt-3 hidden space-y-1 sm:block">{visibleAvailableIds.map((id) => { const player = players.find((p) => p.id === id); return player ? <div key={id} title={isDungeonMaster ? player.name : ""} className="flex items-center gap-1.5 rounded-md bg-black/35 px-1.5 py-1 text-[11px] font-semibold text-white"><PlayerToken player={player} campaignId={activeCampaign?.id} size="sm" className="h-4 w-4 border-amber-300" /><span className="truncate">{isDungeonMasterResponse(player.id) ? "DM available" : isDungeonMaster ? player?.campaignCharacterNames?.[activeCampaign?.id] || player?.name : "You available"}</span></div> : null; })}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  function PlayersPage() {
    return (
      <div className="grid gap-4 lg:grid-cols-[320px_1fr] xl:grid-cols-[360px_1fr]">
        <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
          <CardContent className="space-y-3 p-6">
            <h2 className="text-2xl font-bold">Campaigns</h2>
            <p className="text-sm text-zinc-400">Join an existing campaign or create a new one.</p>

            <select
              value={activeCampaign?.id ?? ""}
              onChange={(event) => joinCampaign(event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-black/50 px-3 py-3 outline-none ring-red-600/40 focus:ring-2"
            >
              {visibleCampaigns.map((campaign, index) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name || `Campaign ${index + 1}`}
                </option>
              ))}
            </select>

            <Button onClick={addCampaign} className="w-full rounded-xl bg-red-700 hover:bg-red-600">
              <Plus className="mr-2 h-4 w-4" /> Add Campaign
            </Button>
          </CardContent>
        </Card>

        {isDungeonMaster && hasPlanFeature("playerInvites") && (
          <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
            <CardContent className="space-y-3 p-6">
              <h2 className="text-2xl font-bold">Invite Players</h2>
              <input value={newPlayer} onChange={(event) => setNewPlayer(event.target.value)} placeholder="Player name" className="w-full rounded-xl border border-zinc-700 bg-black/50 px-3 py-2" />
              <input value={newPlayerEmail} onChange={(event) => setNewPlayerEmail(event.target.value)} placeholder="Email optional" className="w-full rounded-xl border border-zinc-700 bg-black/50 px-3 py-2" />
              <input value={newPlayerPhone} onChange={(event) => setNewPlayerPhone(event.target.value)} placeholder="Phone optional" className="w-full rounded-xl border border-zinc-700 bg-black/50 px-3 py-2" />
              <Button onClick={addPlayer} className="w-full rounded-xl bg-red-700 hover:bg-red-600"><Plus className="mr-2 h-4 w-4" /> Add Invite</Button>
            </CardContent>
          </Card>
        )}

        <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur xl:col-span-2">
          <CardContent className="p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">Players</h2>
                <p className="text-sm text-zinc-400">Manage party members, invites, and Guildmaster token images.</p>
              </div>
              {hasPlanFeature("tokenUploads") && <span className="rounded-full border border-amber-700 bg-amber-950/40 px-3 py-1 text-xs font-bold text-amber-200">Token Uploads Enabled</span>}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {activeCampaignPlayers.map((player) => {
                const isDmPlayer = activeCampaign?.dungeonMasterIds?.includes(player.id);
                const displayName = player?.campaignCharacterNames?.[activeCampaign?.id] || player?.name;

                return (
                  <div key={player.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <button
                        onClick={() => isDungeonMaster ? setActivePlayerId(player.id) : setActivePlayerId(currentUserId)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <PlayerToken player={player} campaignId={activeCampaign?.id} size="md" />
                        <span className="min-w-0">
                          <b className="block truncate text-base text-zinc-100">{displayName}</b>
                          {player?.campaignCharacterNames?.[activeCampaign?.id] && (
                            <span className="block truncate text-sm text-zinc-400">Player: {player.name}</span>
                          )}
                          <span className="block text-xs text-zinc-500">{isDmPlayer ? "Dungeon Master" : "Player"}</span>
                        </span>
                      </button>

                      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                        {isDungeonMaster && hasPlanFeature("tokenUploads") && (
                          <div className="flex flex-col gap-2">
                            <label className="cursor-pointer rounded-lg border border-amber-700 px-3 py-2 text-center text-xs font-bold text-amber-200 hover:bg-amber-950/40">
                              Upload Token
                              <input type="file" accept="image/*" className="hidden" onChange={(event) => updatePlayerToken(player.id, event.target.files?.[0], activeCampaign?.id)} />
                            </label>

                            {player.campaignTokenImages?.[activeCampaign?.id] && (
                              <button
                                onClick={() => removePlayerToken(player.id, activeCampaign?.id)}
                                className="rounded-lg border border-red-800 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-950/50"
                              >
                                Remove Token
                              </button>
                            )}
                          </div>
                        )}

                        {isDungeonMaster && !isDmPlayer && (
                          <button onClick={() => removePlayer(player.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-red-950 hover:text-red-200" title="Remove player">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {isDungeonMaster && !isDmPlayer && (
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
                        {player.email && <button type="button" onClick={() => openEmailInvitePopup(player)} className="inline-flex items-center gap-1 rounded-lg bg-blue-700 px-2 py-1 text-xs font-bold"><Mail className="h-3 w-3" /> Email</button>}
                        {player.phone && <a href={`sms:${player.phone}?&body=${encodeURIComponent(getInviteMessage(player.name))}`} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2 py-1 text-xs font-bold"><MessageSquare className="h-3 w-3" /> Text</a>}
                        <button onClick={() => navigator.clipboard.writeText(getLoginLink(player.name))} className="inline-flex items-center gap-1 rounded-lg bg-zinc-700 px-2 py-1 text-xs font-bold"><Copy className="h-3 w-3" /> Copy link</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  function ResultsPage() {
    const resultDates = Array.from(new Set([
      ...Object.keys(availability),
      ...Object.keys(unavailable)
    ])).filter((key) => !isGeneratedOnlyDate(activeCampaign, key)).sort((a, b) => {
      const aAvailable = availability[a]?.length ?? 0;
      const bAvailable = availability[b]?.length ?? 0;
      return bAvailable - aAvailable || a.localeCompare(b);
    });

    return (
      <div className="space-y-5">
        <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
          <CardContent className="p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-bold">Availability Results</h2>
              {isDungeonMaster && plan !== "free" && (
                <Button onClick={chooseBestDateAutomatically} className="rounded-xl bg-emerald-700 hover:bg-emerald-600">
                  Auto Pick Best Date
                </Button>
              )}
            </div>
            {isDungeonMaster && (
              <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <h3 className="mb-2 font-bold text-amber-200">Final Date & Recurring Sessions</h3>
                <p className="mb-3 text-sm text-zinc-400">{chosenDate ? new Date(chosenDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "No final date selected"}</p>
                <div className="grid gap-3 md:grid-cols-4">
                  <select value={recurringCadence} onChange={(event) => setRecurringCadence(event.target.value)} className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100">
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  <input value={recurringSessionCount} onChange={(event) => setRecurringSessionCount(event.target.value)} type="number" min="1" max="52" placeholder="How many sessions" className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100" />
                  <Button onClick={generateRecurringSessions} disabled={!chosenDate} className="rounded-xl bg-amber-600 hover:bg-amber-500">Generate Dates</Button>
                  <Button onClick={removeGeneratedSessions} disabled={!generatedSessionDates.length} variant="ghost" className="rounded-xl border border-zinc-700 hover:bg-zinc-900 hover:text-white">Remove Generated</Button>
                </div>
                {chosenDate && <Button onClick={clearFinalDate} variant="ghost" className="mt-3 rounded-xl border border-zinc-700 hover:bg-zinc-900 hover:text-white">Remove Final Date</Button>}
                {generatedSessionDates.length > 0 && <p className="mt-3 text-sm text-zinc-400">Generated session records saved outside availability/results: {generatedSessionDates.map((key) => new Date(key + "T00:00:00").toLocaleDateString()).join(", ")}</p>}
              </div>
            )}
            <div className="space-y-3">
              {resultDates.length === 0 ? (
                <p className="text-zinc-400">No availability has been marked yet.</p>
              ) : resultDates.map((key) => {
                const availableIds = availability[key] ?? [];
                const unavailableIds = unavailable[key] ?? [];
                const availableNames = hasPlanFeature("fullTracking")
                  ? availableIds.map((id) => {
                    const player = players.find((p) => p.id === id);
                    return player?.campaignCharacterNames?.[activeCampaign?.id] || player?.name;
                  }).filter(Boolean)
                  : [];
                const unavailableNames = hasPlanFeature("fullTracking")
                  ? unavailableIds.map((id) => {
                    const player = players.find((p) => p.id === id);
                    return player?.campaignCharacterNames?.[activeCampaign?.id] || player?.name;
                  }).filter(Boolean)
                  : [];

                return (
                  <div key={key} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <b>{new Date(key + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</b>
                        <p className="mt-1 text-sm text-emerald-300">
                          Available: {hasPlanFeature("fullTracking") ? (availableNames.length ? availableNames.join(", ") : "None") : "Upgrade to Guildmaster to see full player tracking"}
                        </p>
                        <p className="mt-1 text-sm text-red-300">
                          Not Available: {hasPlanFeature("fullTracking") ? (unavailableNames.length ? unavailableNames.join(", ") : "None") : "Upgrade to Guildmaster to see full player tracking"}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <span className="rounded-full bg-emerald-700 px-3 py-1 text-sm font-bold">
                          {availableIds.length}/{activeCampaignPlayers.length} available
                        </span>
                        {unavailableIds.length > 0 && (
                          <span className="rounded-full bg-red-700 px-3 py-1 text-sm font-bold">
                            {unavailableIds.length} not available
                          </span>
                        )}
                      </div>
                    </div>

                    {isDungeonMaster && availableIds.length > 0 && (
                      <Button
                        onClick={() => chooseFinalDate(key)}
                        className="mt-4 rounded-xl bg-red-700 hover:bg-red-600"
                      >
                        {chosenDate === key ? "Final date selected" : "Choose final date manually"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  function AccountSettingsPage() {
    const currentPlan = planLimits[plan] ?? planLimits.free;
    const campaignCount = ownedCampaignsForUser().length;
    const invitedCampaignCount = Math.max((currentUser?.campaignIds?.length ?? 0) - campaignCount, 0);
    const characterCount = Object.values(currentUser?.campaignCharacterNames || {}).filter(Boolean).length;
    const accountCompletionItems = [accountUsername, accountName, accountEmail, accountPassword].filter(Boolean).length;
    const accountCompletion = Math.round((accountCompletionItems / 4) * 100);
    const userCampaignRoles = campaigns.reduce((totals, campaign) => {
      if (campaign.dungeonMasterIds?.includes(currentUser?.id)) return { ...totals, dm: totals.dm + 1 };
      if ((currentUser?.campaignIds ?? []).includes(campaign.id)) return { ...totals, player: totals.player + 1 };
      return totals;
    }, { dm: 0, player: 0 });
    const accountIdLabel = currentUser?.id ? currentUser.id.slice(0, 8).toUpperCase() : "N/A";

    const renderSettingRow = ({ label, value, field, type = "text", placeholder = "" }) => (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">{label}</p>
            {editingField === field ? (
              <input
                value={field === "username" ? accountUsername : field === "name" ? accountName : field === "phone" ? accountPhone : field === "email" ? accountEmail : accountPassword}
                onChange={(event) => {
                  if (field === "username") setAccountUsername(event.target.value);
                  if (field === "name") setAccountName(event.target.value);
                  if (field === "phone") setAccountPhone(event.target.value);
                  if (field === "email") setAccountEmail(event.target.value);
                  if (field === "password") setAccountPassword(event.target.value);
                }}
                type={type}
                placeholder={placeholder}
                className="mt-3 w-full min-w-[260px] rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 text-zinc-100 outline-none ring-red-600/40 focus:ring-2"
                onKeyDown={(event) => { if (event.key === "Enter") saveAccountSettings(event); }}
              />
            ) : (
              <p className={classNames("mt-2 text-lg font-semibold text-zinc-100", field === "password" && "tracking-[0.3em]")}>{value}</p>
            )}
          </div>

          <Button
            onClick={() => {
              if (field === "password" && editingField !== "password") {
                setShowPasswordVerify(true);
                setCurrentPasswordInput("");
                return;
              }
              setEditingField(editingField === field ? "" : field);
            }}
            variant="ghost"
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900"
          >
            {editingField === field ? "Cancel" : "Edit"}
          </Button>
        </div>
      </div>
    );

    return (
      <div className="space-y-6">
        <Card className="overflow-hidden border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
          <CardContent className="p-0">
            <div className="border-b border-zinc-800 bg-gradient-to-r from-red-950/70 via-zinc-950/80 to-black/70 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.3em] text-red-300">Account Center</p>
                  <h2 className="mt-2 text-3xl font-black">User Settings</h2>
                  <p className="mt-2 max-w-2xl text-sm text-zinc-300">Manage your profile, login details, membership plan, campaign identities, and account security.</p>
                </div>
                <div className="rounded-2xl border border-red-900/70 bg-black/40 px-5 py-4 text-right">
                  <p className="text-xs uppercase tracking-widest text-zinc-500">Signed in as</p>
                  <p className="text-xl font-bold text-white">{accountUsername || accountName || "Adventurer"}</p>
                  <p className="text-sm text-red-300">{activeCampaignRole}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-5 p-6 lg:grid-cols-4">
              <div className="rounded-2xl border border-amber-800/70 bg-amber-950/25 p-5 lg:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-amber-400">Membership</p>
                    <h3 className="mt-2 text-2xl font-black text-amber-100">{currentPlan.name} Plan</h3>
                    <p className="mt-1 text-sm text-zinc-300">
                      {plan === "guildmaster" ? "Unlimited campaign creation for dedicated Dungeon Masters. Invited campaigns and character roles are always included." : plan === "adventurer" ? "Create up to 5 campaigns. Invited campaigns and character roles are always included." : "Create 1 campaign. Invited campaigns and character roles are always included."}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-black">{formatPlanPrice(plan)}</p>
                    {plan !== "free" && <p className="text-sm text-zinc-400">{billingInterval === "yearly" ? "billed yearly" : "billed monthly"}</p>}
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-zinc-800 bg-black/35 p-4">
                    <p className="text-sm text-zinc-400">Created Campaigns</p>
                    <p className="mt-1 text-xl font-bold">{campaignCount}/{currentPlan.campaigns === Infinity ? "∞" : currentPlan.campaigns}</p>
                    <p className="mt-1 text-xs text-zinc-500">Invited campaigns do not count.</p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-black/35 p-4">
                    <p className="text-sm text-zinc-400">Invited Campaigns / Characters</p>
                    <p className="mt-1 text-xl font-bold">Included</p>
                    <p className="mt-1 text-xs text-zinc-500">{invitedCampaignCount} invited campaign(s), {characterCount} character role(s).</p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <Button onClick={() => setPage("billing")} className="rounded-xl bg-amber-700 hover:bg-amber-600">
                    Change Plan
                  </Button>
                  {plan !== "free" && (
                    <Button onClick={cancelCurrentPlan} variant="ghost" className="rounded-xl border border-red-800 text-red-200 hover:bg-red-950 hover:text-white">
                      Cancel Membership
                    </Button>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
                <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Profile Completion</p>
                <p className="mt-3 text-4xl font-black text-white">{accountCompletion}%</p>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-red-600" style={{ width: `${accountCompletion}%` }} />
                </div>
                <p className="mt-3 text-sm text-zinc-400">Add username, name, email, and password to complete your account profile.</p>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
                <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Account Summary</p>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-black/35 px-3 py-2">
                    <span className="text-zinc-400">Account ID</span>
                    <span className="font-bold text-zinc-100">{accountIdLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-black/35 px-3 py-2">
                    <span className="text-zinc-400">DM Campaigns</span>
                    <span className="font-bold text-red-300">{userCampaignRoles.dm}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-black/35 px-3 py-2">
                    <span className="text-zinc-400">Player Campaigns</span>
                    <span className="font-bold text-emerald-300">{userCampaignRoles.player}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-black/35 px-3 py-2">
                    <span className="text-zinc-400">Remember Me</span>
                    <span className="font-bold text-amber-300">{rememberMe ? "On" : "Off"}</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
            <CardContent className="space-y-4 p-6">
              <div>
                <h3 className="text-2xl font-bold">Profile & Login Details</h3>
                <p className="mt-1 text-sm text-zinc-400">Update the personal details used for login, account display, and campaign invites.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {renderSettingRow({ label: "Username", field: "username", value: accountUsername || "No username added", placeholder: "Choose a username" })}
                {renderSettingRow({ label: "Full Name", field: "name", value: accountName || "No name added", placeholder: "Enter full name" })}
                {renderSettingRow({ label: "Phone Number", field: "phone", type: "tel", value: accountPhone || "No phone number added", placeholder: "Enter phone number" })}
                {renderSettingRow({ label: "Email Address", field: "email", type: "email", value: accountEmail || "No email added", placeholder: "Enter email" })}
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Password</p>
                    <p className="mt-2 text-sm text-zinc-400">Change your login password separately from your profile details.</p>

                    {showPasswordVerify ? (
                      <form onSubmit={verifyCurrentPassword} className="mt-3 rounded-xl border border-red-900 bg-red-950/30 p-4">
                        <p className="mb-3 text-sm text-zinc-300">Step 1: enter your current password.</p>
                        <div className="relative">
                          <input
                            value={currentPasswordInput}
                            onChange={(event) => setCurrentPasswordInput(event.target.value)}
                            type={showCurrentPasswordText ? "text" : "password"}
                            autoComplete="current-password"
                            placeholder="Current password"
                            className="w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 pr-20 outline-none ring-red-600/40 focus:ring-2"
                          />
                          <button
                            type="button"
                            onClick={() => setShowCurrentPasswordText((value) => !value)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-red-200 hover:text-white"
                          >
                            {showCurrentPasswordText ? "Hide" : "Show"}
                          </button>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <Button type="submit" disabled={isSavingAccount} className="rounded-xl bg-red-700 hover:bg-red-600">{isSavingAccount ? "Verifying..." : "Verify Password"}</Button>
                          <Button onClick={() => resetPasswordChangeForm()} variant="ghost" className="rounded-xl border border-zinc-700 hover:bg-zinc-900">Cancel</Button>
                        </div>
                      </form>
                    ) : passwordVerified ? (
                      <form onSubmit={savePasswordChange} className="mt-3 rounded-xl border border-emerald-900 bg-emerald-950/25 p-4">
                        <p className="mb-3 text-sm text-zinc-300">Step 2: enter your new password.</p>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="relative">
                            <input
                              value={newPasswordInput}
                              onChange={(event) => setNewPasswordInput(event.target.value)}
                              type={showNewPasswordText ? "text" : "password"}
                              autoComplete="new-password"
                              placeholder="New password"
                              className="w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 pr-20 outline-none ring-red-600/40 focus:ring-2"
                            />
                            <button
                              type="button"
                              onClick={() => setShowNewPasswordText((value) => !value)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-emerald-200 hover:text-white"
                            >
                              {showNewPasswordText ? "Hide" : "Show"}
                            </button>
                          </div>
                          <div className="relative">
                            <input
                              value={confirmPasswordInput}
                              onChange={(event) => setConfirmPasswordInput(event.target.value)}
                              type={showConfirmPasswordText ? "text" : "password"}
                              autoComplete="new-password"
                              placeholder="Confirm new password"
                              className="w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 pr-20 outline-none ring-red-600/40 focus:ring-2"
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPasswordText((value) => !value)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-emerald-200 hover:text-white"
                            >
                              {showConfirmPasswordText ? "Hide" : "Show"}
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <Button type="submit" disabled={isSavingAccount} className="rounded-xl bg-emerald-700 hover:bg-emerald-600">{isSavingAccount ? "Saving..." : "Save New Password"}</Button>
                          <Button onClick={() => resetPasswordChangeForm()} variant="ghost" className="rounded-xl border border-zinc-700 hover:bg-zinc-900">Cancel</Button>
                        </div>
                      </form>
                    ) : (
                      <p className="mt-2 text-lg font-semibold tracking-[0.3em] text-zinc-100">••••••••</p>
                    )}
                  </div>
                  {!showPasswordVerify && !passwordVerified && (
                    <Button
                      onClick={() => {
                        if (!userUsesPasswordLogin()) {
                          setAccountMessage("This account signs in with Google. Change the password from your Google account settings.");
                          return;
                        }
                        setShowPasswordVerify(true);
                        setPasswordVerified(false);
                        setCurrentPasswordInput("");
                        setNewPasswordInput("");
                        setConfirmPasswordInput("");
                        setShowCurrentPasswordText(false);
                        setShowNewPasswordText(false);
                        setShowConfirmPasswordText(false);
                        setAccountMessage("");
                      }}
                      variant="ghost"
                      className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900"
                    >
                      Change Password
                    </Button>
                  )}
                </div>
              </div>

              {accountMessage && <p className="rounded-xl border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">{accountMessage}</p>}

              <div className="flex flex-wrap gap-3">
                <Button onClick={saveAccountSettings} disabled={isSavingAccount} className="rounded-xl bg-red-700 px-6 py-3 hover:bg-red-600">
                  {isSavingAccount ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
            <CardContent className="space-y-5 p-6">
              <div>
                <h3 className="text-2xl font-bold">Account Security</h3>
                <p className="mt-1 text-sm text-zinc-400">Control high-impact account actions.</p>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
                <p className="font-bold text-zinc-100">Delete Account</p>
                <p className="mt-2 text-sm text-zinc-400">Permanently removes your account and availability from campaigns where you are not the Dungeon Master.</p>
                <Button onClick={() => setShowDeleteConfirm(true)} variant="ghost" className="mt-4 rounded-xl border border-red-800 text-red-200 hover:bg-red-950 hover:text-white">
                  Delete Account
                </Button>
              </div>

              {showDeleteConfirm && (
                <div className="rounded-2xl border border-red-900 bg-red-950/40 p-5">
                  <h3 className="text-lg font-bold text-red-200">Confirm Account Deletion</h3>
                  <p className="mt-2 text-sm text-zinc-300">This action cannot be undone. Type <span className="font-bold text-red-300">DELETE</span> below to confirm.</p>
                  <input
                    value={deleteConfirmText}
                    onChange={(event) => setDeleteConfirmText(event.target.value)}
                    placeholder="Type DELETE"
                    className="mt-4 w-full rounded-xl border border-red-800 bg-black/50 px-4 py-3 outline-none ring-red-600/40 focus:ring-2"
                  />
                  <div className="mt-4 flex gap-3">
                    <Button onClick={deleteCurrentAccount} className="rounded-xl bg-red-700 hover:bg-red-600">Confirm Delete</Button>
                    <Button onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(""); setAccountMessage(""); }} variant="ghost" className="rounded-xl border border-zinc-700 hover:bg-zinc-900">Cancel</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
          <CardContent className="space-y-5 p-6">
            <div>
              <h3 className="text-2xl font-bold">Campaign Memberships</h3>
              <p className="mt-1 text-sm text-zinc-400">Manage your character name and role for every campaign you have access to.</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {visibleCampaigns.map((campaign, index) => {
                const isMember = (currentUser?.campaignIds ?? []).includes(campaign.id);
                const isDmForCampaign = campaign.dungeonMasterIds?.includes(currentUser?.id);
                return (
                  <div key={campaign.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Campaign</p>
                        <h4 className="mt-1 text-xl font-bold text-zinc-100">{campaign.name || `Campaign ${index + 1}`}</h4>
                        <p className="mt-1 text-sm text-zinc-400">{isDmForCampaign ? "Dungeon Master" : isMember ? "Player" : "Not Joined"}</p>
                      </div>
                      <span className={classNames("rounded-full px-3 py-1 text-xs font-bold", isDmForCampaign ? "bg-red-700 text-white" : isMember ? "bg-emerald-700 text-white" : "bg-zinc-800 text-zinc-300")}>{isDmForCampaign ? "DM" : isMember ? "Member" : "Available"}</span>
                    </div>

                    <div className="mt-4">
                      <label className="text-xs uppercase tracking-wider text-zinc-500">Character Name</label>
                      <input
                        value={currentUser?.campaignCharacterNames?.[campaign.id] || ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setPlayers((current) => current.map((player) => player.id === currentUser.id ? {
                            ...player,
                            campaignCharacterNames: {
                              ...(player.campaignCharacterNames || {}),
                              [campaign.id]: value
                            }
                          } : player));
                        }}
                        placeholder="Enter character name"
                        className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 outline-none ring-red-600/40 focus:ring-2"
                      />
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                      <div>
                        <label className="text-xs uppercase tracking-wider text-zinc-500">Role in this campaign</label>
                        <select
                          value={isDmForCampaign ? "Dungeon Master" : "Player"}
                          onChange={(event) => setCampaignRoleForCurrentUser(campaign.id, event.target.value)}
                          className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/50 px-3 py-3 outline-none ring-red-600/40 focus:ring-2"
                        >
                          <option value="Player">Player</option>
                          <option value="Dungeon Master">Dungeon Master</option>
                        </select>
                      </div>

                      {isMember ? (
                        <Button onClick={() => leaveCampaign(campaign.id)} variant="ghost" className="rounded-xl border border-red-800 text-red-200 hover:bg-red-950 hover:text-white">
                          Leave
                        </Button>
                      ) : (
                        <Button onClick={() => joinCampaign(campaign.id)} className="rounded-xl bg-red-700 hover:bg-red-600">
                          Join
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  function SettingsPage() {
    return (
      <div className="space-y-5">
        <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
          <CardContent className="space-y-5 p-6">
            <h2 className="text-2xl font-bold">Campaign Settings</h2>
            {isDungeonMaster && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <label className="text-sm font-bold text-zinc-300">Campaign Name</label>
                {isEditingCampaignName ? (
                  <>
                    <input value={campaignName} onChange={(event) => updateActiveCampaign(() => ({ name: event.target.value }))} onKeyDown={(event) => event.key === "Enter" && updateActiveCampaign(() => ({ isEditingName: false }))} placeholder="Enter campaign name" className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3" />
                    <Button onClick={() => updateActiveCampaign(() => ({ isEditingName: false }))} className="mt-3 rounded-xl bg-red-700 hover:bg-red-600">Save Campaign Name</Button>
                  </>
                ) : (
                  <div className="mt-3 flex items-center justify-between rounded-xl border border-zinc-700 bg-black/40 px-4 py-3">
                    <span className="text-lg font-bold">{campaignName || "Unnamed Campaign"}</span>
                    <Button onClick={() => updateActiveCampaign(() => ({ isEditingName: true }))} variant="ghost" className="border border-zinc-700 hover:bg-zinc-900">Edit</Button>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <h3 className="font-bold">Session Defaults</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-amber-300">Start Time</span>
                  <input type="time" value={sessionTime} onChange={(event) => updateActiveCampaign(() => ({ sessionTime: event.target.value }))} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className="w-full rounded-xl border border-zinc-700 bg-black/60 px-3 py-2" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-amber-300">Duration</span>
                  <input type="number" min="1" max="12" value={sessionDuration} onChange={(event) => updateActiveCampaign(() => ({ sessionDuration: event.target.value }))} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className="w-full rounded-xl border border-zinc-700 bg-black/60 px-3 py-2" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-[0.18em] text-amber-300">Reminder Time</span>
                  <select value={reminderHours} onChange={(event) => updateActiveCampaign(() => ({ reminderHours: event.target.value }))} className="w-full rounded-xl border border-zinc-700 bg-black/60 px-3 py-2">
                    <option value={1}>1 hour reminder</option>
                    <option value={6}>6 hours</option>
                    <option value={12}>12 hours</option>
                    <option value={24}>24 hours</option>
                    <option value={48}>2 days</option>
                  </select>
                </label>
              </div>
            </div>
          </CardContent>
        </Card>

        {isDungeonMaster && hasPlanFeature("playerInvites") && (
          <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
            <CardContent className="space-y-3 p-6">
              <h2 className="text-2xl font-bold">Invite Players</h2>
              <p className="text-sm text-zinc-400">Players belong to this campaign. Only Dungeon Masters can invite or remove them.</p>
              <input value={newPlayer} onChange={(event) => setNewPlayer(event.target.value)} placeholder="Player name" className="w-full rounded-xl border border-zinc-700 bg-black/50 px-3 py-2" />
              <input value={newPlayerEmail} onChange={(event) => setNewPlayerEmail(event.target.value)} placeholder="Email optional" className="w-full rounded-xl border border-zinc-700 bg-black/50 px-3 py-2" />
              <input value={newPlayerPhone} onChange={(event) => setNewPlayerPhone(event.target.value)} placeholder="Phone optional" className="w-full rounded-xl border border-zinc-700 bg-black/50 px-3 py-2" />
              <Button onClick={addPlayer} className="w-full rounded-xl bg-red-700 hover:bg-red-600"><Plus className="mr-2 h-4 w-4" /> Add Invite</Button>
            </CardContent>
          </Card>
        )}

        <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
          <CardContent className="p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">Campaign Players</h2>
                <p className="text-sm text-zinc-400">Manage campaign members, invite sharing, token images, and removals.</p>
              </div>
              {hasPlanFeature("tokenUploads") && <span className="rounded-full border border-amber-700 bg-amber-950/40 px-3 py-1 text-xs font-bold text-amber-200">Token Uploads Enabled</span>}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {activeCampaignPlayers.map((player) => {
                const isDmPlayer = activeCampaign?.dungeonMasterIds?.includes(player.id);
                const displayName = player?.campaignCharacterNames?.[activeCampaign?.id] || player?.name;

                return (
                  <div key={player.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <button onClick={() => isDungeonMaster ? setActivePlayerId(player.id) : setActivePlayerId(currentUserId)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <PlayerToken player={player} campaignId={activeCampaign?.id} size="md" />
                        <span className="min-w-0">
                          <b className="block truncate text-base text-zinc-100">{displayName}</b>
                          {player?.campaignCharacterNames?.[activeCampaign?.id] && <span className="block truncate text-sm text-zinc-400">Player: {player.name}</span>}
                          <span className="block text-xs text-zinc-500">{isDmPlayer ? "Dungeon Master" : "Player"}</span>
                        </span>
                      </button>

                      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                        {isDungeonMaster && hasPlanFeature("tokenUploads") && (
                          <div className="flex flex-col gap-2">
                            <label className="cursor-pointer rounded-lg border border-amber-700 px-3 py-2 text-center text-xs font-bold text-amber-200 hover:bg-amber-950/40">
                              Upload Token
                              <input type="file" accept="image/*" className="hidden" onChange={(event) => updatePlayerToken(player.id, event.target.files?.[0], activeCampaign?.id)} />
                            </label>
                            {player.campaignTokenImages?.[activeCampaign?.id] && <button onClick={() => removePlayerToken(player.id, activeCampaign?.id)} className="rounded-lg border border-red-800 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-950/50">Remove Token</button>}
                          </div>
                        )}
                        {isDungeonMaster && !isDmPlayer && <button onClick={() => removePlayer(player.id)} className="inline-flex items-center gap-2 rounded-lg border border-red-900 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-950" title="Remove player"><Trash2 className="h-4 w-4" /> Remove Player</button>}
                      </div>
                    </div>

                    {isDungeonMaster && !isDmPlayer && (
                      <div className="mt-4 grid gap-2 border-t border-zinc-800 pt-3 sm:grid-cols-3">
                        {player.email && <button type="button" onClick={() => openEmailInvitePopup(player)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-700 bg-blue-950/50 px-3 py-2 text-xs font-black text-blue-100 shadow-lg shadow-blue-950/20 hover:bg-blue-900/70"><Mail className="h-3 w-3" /> Email</button>}
                        {player.phone && <a href={`sms:${player.phone}?&body=${encodeURIComponent(getInviteMessage(player.name))}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-700 bg-emerald-950/50 px-3 py-2 text-xs font-black text-emerald-100 shadow-lg shadow-emerald-950/20 hover:bg-emerald-900/70"><MessageSquare className="h-3 w-3" /> Text</a>}
                        <button onClick={() => navigator.clipboard.writeText(getLoginLink(player.name))} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-700 bg-amber-950/50 px-3 py-2 text-xs font-black text-amber-100 shadow-lg shadow-amber-950/20 hover:bg-amber-900/70"><Copy className="h-3 w-3" /> Copy Link</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  function UpcomingSession() {
    function firstName(player) {
      const fullName = activeCampaign?.dungeonMasterIds?.includes(player.id)
        ? "DM"
        : player?.campaignCharacterNames?.[activeCampaign?.id] || player?.name || "Player";

      return fullName.trim().split(/\s+/)[0];
    }

    const availablePlayers = chosenDate
      ? (availability[chosenDate] ?? []).map((id) => players.find((p) => p.id === id)).filter(Boolean)
      : [];

    const unavailablePlayers = chosenDate
      ? (unavailable[chosenDate] ?? []).map((id) => players.find((p) => p.id === id)).filter(Boolean)
      : [];

    return (
      <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
        <CardContent className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CalendarCheck className="h-6 w-6 text-red-400" />
              <h2 className="text-2xl font-bold">Upcoming Session</h2>
            </div>

            {isDungeonMaster && (
              <div className="flex flex-wrap gap-2">
                {plan !== "free" && (
                  <Button
                    onClick={chooseBestDateAutomatically}
                    className="rounded-xl bg-emerald-700 hover:bg-emerald-600"
                  >
                    Auto Pick Best Date
                  </Button>
                )}

                {chosenDate && (
                  <Button
                    onClick={() => updateActiveCampaign(() => ({ chosenDate: "" }))}
                    variant="ghost"
                    className="rounded-xl border border-red-800 text-red-200 hover:bg-red-950 hover:text-white"
                  >
                    Remove Final Date
                  </Button>
                )}
              </div>
            )}
          </div>

          <p className="text-zinc-300">{selectedDateLabel}</p>

          {chosenDate && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/35 p-4">
                <p className="text-sm text-zinc-400">Available</p>
                <p className="text-2xl font-bold text-emerald-300">
                  {availablePlayers.length}/{activeCampaignPlayers.length}
                </p>
              </div>

              <div className="rounded-xl border border-red-800/60 bg-red-950/35 p-4">
                <p className="text-sm text-zinc-400">Not Available</p>
                <p className="text-2xl font-bold text-red-300">
                  {unavailablePlayers.length}/{activeCampaignPlayers.length}
                </p>
              </div>
            </div>
          )}

          {chosenDate && availablePlayers.length > 0 && (
            <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <h3 className="mb-3 text-lg font-bold text-amber-300">Available Players</h3>

              <div className="flex flex-wrap gap-4">
                {availablePlayers.map((player) => (
                  <div
                    key={player.id}
                    className="flex w-24 flex-col items-center gap-2 rounded-2xl border border-zinc-700 bg-black/50 px-3 py-4 text-center text-sm font-semibold"
                  >
                    <PlayerToken player={player} campaignId={activeCampaign?.id} size="xl" />
                    <div className="flex max-w-full items-center justify-center gap-1.5">
                      <span className={classNames("h-2.5 w-2.5 shrink-0 rounded-full", activeCampaign?.dungeonMasterIds?.includes(player.id) ? "bg-red-600" : player.color)} />
                      <span className="truncate">{firstName(player)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {chosenDate && unavailablePlayers.length > 0 && (
            <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <h3 className="mb-3 text-lg font-bold text-red-300">Not Available Players</h3>

              <div className="flex flex-wrap gap-4">
                {unavailablePlayers.map((player) => (
                  <div
                    key={player.id}
                    className="flex w-24 flex-col items-center gap-2 rounded-2xl border border-red-900/70 bg-red-950/50 px-3 py-4 text-center text-sm font-semibold text-red-100"
                  >
                    <PlayerToken player={player} campaignId={activeCampaign?.id} size="xl" />
                    <div className="flex max-w-full items-center justify-center gap-1.5">
                      <span className={classNames("h-2.5 w-2.5 shrink-0 rounded-full", activeCampaign?.dungeonMasterIds?.includes(player.id) ? "bg-red-600" : player.color)} />
                      <span className="truncate">{firstName(player)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {chosenDate && calendarEvent && (
            hasPlanFeature("calendarExport") ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <a
                  href={calendarEvent.googleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 py-3 text-center font-bold hover:bg-zinc-900"
                >
                  Add to Google Calendar
                </a>

                <a
                  href={calendarEvent.outlookUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 py-3 text-center font-bold hover:bg-zinc-900"
                >
                  Add to Outlook
                </a>

                <a
                  href={calendarEvent.icsUrl}
                  download={`${campaignName || "dnd-session"}.ics`}
                  className="rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 py-3 text-center font-bold hover:bg-zinc-900"
                >
                  Add to Apple Calendar
                </a>
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-amber-700 bg-amber-950/30 p-4 text-sm text-amber-200">
                Calendar export is included with Adventurer and Guildmaster plans.
                <Button onClick={() => setPage("billing")} className="ml-3 rounded-xl bg-amber-700 hover:bg-amber-600">
                  View Plans
                </Button>
              </div>
            )
          )}
        </CardContent>
      </Card>
    );
  }

  function CalendarOverview() {
    const previewDates = dates.slice(0, 35);
    return (
      <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
        <CardContent className="p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">Calendar Overview</h2>
              <p className="text-sm text-zinc-400">A quick look at current party availability.</p>
            </div>
            <Button onClick={() => setPage("calendar")} className="rounded-xl bg-red-700 hover:bg-red-600">Open Calendar</Button>
          </div>
          <div className="mb-3 grid grid-cols-7 gap-2 text-center text-xs font-bold text-zinc-500">
            {dayNames.map((day) => <div key={day}>{day}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {previewDates.map((date) => {
              const key = dateKey(date);
              const generatedOnly = isGeneratedOnlyDate(activeCampaign, key);
              const showOnlyFinal = !!chosenDate && key !== chosenDate;
              const ids = (generatedOnly || showOnlyFinal) ? [] : (availability[key] ?? []);
              const unavailableIds = (generatedOnly || showOnlyFinal) ? [] : (unavailable[key] ?? []);
              const hasDungeonMasterAvailable = ids.some((id) => isDungeonMasterResponse(id));
              const hasDungeonMasterUnavailable = unavailableIds.some((id) => isDungeonMasterResponse(id));
              const isChosenDate = key === chosenDate;
              return (
                <button
                  key={key}
                  onClick={() => setPage("calendar")}
                  className={classNames(
                    "aspect-square rounded-xl border border-zinc-800 p-2 text-left text-sm font-bold transition hover:scale-105",
                    date.getMonth() !== viewDate.getMonth() && "opacity-35",
                    dateVisualState({ ids, unavailableIds, hasDungeonMasterAvailable, hasDungeonMasterUnavailable, isChosenDate, isDungeonMaster })
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{date.getDate()}</span>
                    {isChosenDate ? <Shield className="h-3 w-3" /> : (hasDungeonMasterAvailable || hasDungeonMasterUnavailable) && <Shield className="h-3 w-3" />}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  function RecentResults() {
    const recent = bestDates.slice(0, 4);
    return (
      <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
        <CardContent className="p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-2xl font-bold">Recent Results</h2>
            <Button onClick={() => setPage("results")} variant="ghost" className="rounded-xl border border-zinc-700 hover:bg-zinc-900 hover:text-white">View All</Button>
          </div>
          <div className="space-y-3">
            {recent.length === 0 ? (
              <p className="text-zinc-400">No availability results yet.</p>
            ) : recent.map((item) => (
              <div key={item.key} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <b>{new Date(item.key + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</b>
                    <p className="text-sm text-zinc-400">{item.names.join(", ")}</p>
                  </div>
                  <span className="rounded-full bg-red-700 px-3 py-1 text-sm font-bold">{item.count}/{activeCampaignPlayers.length}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  function QuickActions() {
    const actions = [
      { label: "Calendar", description: "Open the calendar and mark availability.", icon: CalendarDays, target: "calendar" },
      { label: "View all Results", description: "Compare every proposed date.", icon: BarChart3, target: "results" },
      ...(isDungeonMaster ? [{ label: "Campaign Settings", description: "Edit campaign and reminder settings.", icon: Settings, target: "settings" }] : [])
    ];

    return (
      <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
        <CardContent className="p-6">
          <h2 className="mb-4 text-2xl font-bold">Quick Actions</h2>
          <div className="space-y-3">
            {actions.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.label} onClick={() => setPage(item.target)} className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-left hover:bg-red-950/40">
                  <Icon className="h-5 w-5 text-red-400" />
                  <span><b>{item.label}</b><span className="block text-sm text-zinc-400">{item.description}</span></span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  function DashboardPage() {
    return <div className="space-y-5">{StatCards()}<div className="grid gap-5 xl:grid-cols-[1fr_420px]">{UpcomingSession()}{QuickActions()}</div><div className="grid gap-5 xl:grid-cols-[1fr_420px]">{CalendarOverview()}{RecentResults()}</div></div>;
  }

  function BillingPage() {
    return (
      <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
        <CardContent className="space-y-6 p-6">
          <div>
            <h2 className="text-2xl font-bold">Plan Options</h2>
            <p className="mt-1 text-sm text-zinc-400">Choose how much campaign scheduling you need.</p>
          </div>

          {billingMessage && <p className="rounded-xl border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">{billingMessage}</p>}

          <div className="rounded-xl border border-blue-800 bg-blue-950/30 p-4 text-sm text-blue-100">
            <p className="font-bold">Stripe subscription sync is automatic</p>
            <p className="mt-1 text-blue-200/90">Choose a paid plan to open Stripe Checkout. After checkout, return to Dungeon Calendar and the app will verify the signed-in account email automatically. Existing subscriptions are also checked automatically each time you log in.</p>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            <div className={classNames("rounded-2xl border p-5", plan === "free" ? "border-emerald-500 bg-emerald-950/30" : "border-zinc-800 bg-zinc-950/60")}>
              <h3 className="text-xl font-bold">Free</h3>
              <p className="mt-2 text-sm text-zinc-300">Perfect for casual adventurers trying out the app for their first campaign.</p>

              <ul className="mt-4 space-y-2 text-sm text-zinc-200">
                <li>• Create 1 campaign</li>
                <li>• Unlimited invited campaigns</li>
                <li>• Unlimited invited character roles</li>
                <li>• Shared scheduling calendar</li>
                <li>• Session reminders</li>
                <li>• Player invite tools</li>
                <li>• Manual final date selection</li>
              </ul>
              <p className="mt-4 text-3xl font-black">$0</p>
              <Button
                onClick={() => plan !== "free" && startPlanCheckout("free")}
                disabled={plan === "free"}
                className={classNames(
                  "mt-5 w-full rounded-xl",
                  plan === "free" ? "bg-emerald-900 text-emerald-200" : "bg-emerald-700 hover:bg-emerald-600"
                )}
              >
                {getPlanActionLabel("free")}
              </Button>
            </div>

            <div className={classNames("rounded-2xl border p-5", plan === "adventurer" ? "border-blue-500 bg-blue-950/30" : "border-zinc-800 bg-zinc-950/60")}>
              <h3 className="text-xl font-bold">Adventurer</h3>
              <p className="mt-2 text-sm text-zinc-300">Built for active players juggling multiple parties, characters, and weekly sessions.</p>

              <ul className="mt-4 space-y-2 text-sm text-zinc-200">
                <li>• Create up to 5 campaigns</li>
                <li>• Unlimited invited campaigns</li>
                <li>• Unlimited invited character roles</li>
                <li>• Shared scheduling calendar</li>
                <li>• Session reminders</li>
                <li>• Player invite tools</li>
                <li>• Manual final date selection</li>
                <li>• Automatic best-date voting</li>
                <li>• Calendar export support</li>
              </ul>
              <p className="mt-4 text-3xl font-black">$2.99/month</p>
              <p className="mt-1 text-sm font-semibold text-emerald-300">or $29.99/year — save $5.89</p>

              <Button
                onClick={() => startPlanCheckout("adventurer")}
                disabled={false}
                className={classNames(
                  "mt-5 w-full rounded-xl",
                  plan === "adventurer" ? "bg-blue-900 text-blue-200" : "bg-blue-700 hover:bg-blue-600"
                )}
              >
                {getPlanActionLabel("adventurer")}
              </Button>
            </div>

            <div className={classNames("rounded-2xl border p-5", plan === "guildmaster" ? "border-red-500 bg-red-950/30" : "border-zinc-800 bg-zinc-950/60")}>
              <h3 className="text-xl font-bold">Guildmaster</h3>
              <p className="mt-2 text-sm text-zinc-300">The ultimate toolkit for dedicated Dungeon Masters and large gaming groups.</p>

              <ul className="mt-4 space-y-2 text-sm text-zinc-200">
                <li>• Unlimited campaign creation</li>
                <li>• Unlimited invited campaigns</li>
                <li>• Unlimited invited character roles</li>
                <li>• Shared scheduling calendar</li>
                <li>• Session reminders</li>
                <li>• Player invite tools</li>
                <li>• Manual final date selection</li>
                <li>• Automatic best-date voting</li>
                <li>• Calendar export support</li>
                <li>• Full party availability tracking</li>
                <li>• Advanced campaign controls</li>
                <li>• Custom player token image uploads</li>
                <li>• Priority access to future premium features</li>
              </ul>
              <p className="mt-4 text-3xl font-black">$4.99/month</p>
              <p className="mt-1 text-sm font-semibold text-emerald-300">or $49.99/year — save $9.89</p>

              <Button
                onClick={() => startPlanCheckout("guildmaster")}
                disabled={false}
                className={classNames(
                  "mt-5 w-full rounded-xl",
                  plan === "guildmaster" ? "bg-red-900 text-red-200" : "bg-red-700 hover:bg-red-600"
                )}
              >
                {getPlanActionLabel("guildmaster")}
              </Button>
            </div>
          </div>

          {selectedPaymentPlan && (
            <div className="rounded-2xl border border-amber-700 bg-zinc-950/80 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-amber-300">Checkout</h3>
                  <p className="mt-1 text-sm text-zinc-300">
                    {planLimits[selectedPaymentPlan].name} Plan — {formatPlanPrice(selectedPaymentPlan, selectedBillingInterval)}
                  </p>
                </div>
                <Button onClick={() => setSelectedPaymentPlan("")} variant="ghost" className="rounded-xl border border-zinc-700 hover:bg-zinc-900">
                  Cancel
                </Button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm text-zinc-300">Billing Name</label>
                  <input
                    value={paymentName}
                    onChange={(event) => setPaymentName(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 outline-none ring-red-600/40 focus:ring-2"
                  />
                </div>

                <div>
                  <label className="text-sm text-zinc-300">Billing Email</label>
                  <input
                    value={paymentEmail}
                    onChange={(event) => setPaymentEmail(event.target.value)}
                    type="email"
                    className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 outline-none ring-red-600/40 focus:ring-2"
                  />
                </div>
              </div>

              <div className="mt-5">
                <label className="text-sm text-zinc-300">Billing Cycle</label>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setSelectedBillingInterval("monthly")}
                    className={classNames(
                      "rounded-xl border px-4 py-3 text-sm font-bold transition",
                      selectedBillingInterval === "monthly" ? "border-amber-400 bg-amber-900/40 text-white" : "border-zinc-700 bg-black/40 text-zinc-300 hover:bg-zinc-900"
                    )}
                  >
                    Monthly — {formatPlanPrice(selectedPaymentPlan, "monthly")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedBillingInterval("yearly")}
                    className={classNames(
                      "rounded-xl border px-4 py-3 text-sm font-bold transition",
                      selectedBillingInterval === "yearly" ? "border-emerald-400 bg-emerald-900/40 text-white" : "border-zinc-700 bg-black/40 text-zinc-300 hover:bg-zinc-900"
                    )}
                  >
                    Yearly — {formatPlanPrice(selectedPaymentPlan, "yearly")}
                    <span className="mt-1 block text-xs text-emerald-300">{yearlySavingsLabel(selectedPaymentPlan)}</span>
                  </button>
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-violet-700 bg-violet-950/30 p-4 text-sm text-violet-100">
                <p className="font-bold">Secure Stripe Checkout</p>
                <p className="mt-1 text-violet-200/90">Payment details are collected by Stripe. Dungeon Calendar never stores card numbers.</p>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-zinc-400">
                  Choose a billing cycle, then continue to the matching Stripe payment page.
                </p>
                <div className="flex flex-wrap gap-2">
                  {paymentMethod === "stripe" && (
                    <div className="rounded-xl border border-violet-700 bg-violet-950/40 px-3 py-2 text-xs font-semibold text-violet-200">
                      Stripe Payment Link Enabled
                    </div>
                  )}

                  {paymentMethod === "shopify" && (
                    <div className="rounded-xl border border-green-700 bg-green-950/40 px-3 py-2 text-xs font-semibold text-green-200">
                      Shopify Payments Connected
                    </div>
                  )}

                  <Button onClick={completePayment} disabled={checkoutLoading} className="rounded-xl bg-amber-600 hover:bg-amber-500">
                    {checkoutLoading ? "Opening Stripe..." : `Continue to Stripe - ${formatPlanPrice(selectedPaymentPlan, selectedBillingInterval)}`}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  function EmailInvitePopup() {
    if (!emailInvitePlayer) return null;

    const inviteBody = getInviteMessage(emailInvitePlayer.name);

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-5 text-zinc-100 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-red-300">Send Invite</p>
              <h3 className="mt-2 text-2xl font-bold">Email Campaign Invite</h3>
              <p className="mt-1 text-sm text-zinc-400">Your Dungeon Calendar page will stay open.</p>
            </div>
            <button type="button" onClick={closeEmailInvitePopup} className="rounded-lg border border-zinc-700 px-3 py-1 text-sm font-bold text-zinc-300 hover:bg-zinc-900">Close</button>
          </div>

          <div className="mt-5 space-y-3">
            <div className="rounded-xl border border-zinc-800 bg-black/40 p-3 text-sm">
              <p className="text-zinc-500">To</p>
              <p className="mt-1 break-all font-semibold text-zinc-100">{emailInvitePlayer.email}</p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-black/40 p-3 text-sm">
              <p className="text-zinc-500">Subject</p>
              <p className="mt-1 font-semibold text-zinc-100">{getInviteEmailSubject()}</p>
            </div>

            <textarea
              readOnly
              value={inviteBody}
              className="min-h-32 w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 text-sm text-zinc-100 outline-none"
            />

            {emailInviteMessage && (
              <p className={classNames("rounded-xl border p-3 text-sm", emailInviteCopied ? "border-emerald-700 bg-emerald-950/40 text-emerald-200" : "border-amber-700 bg-amber-950/40 text-amber-200")}>
                {emailInviteMessage}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-3">
              <Button onClick={copyEmailInviteText} variant="ghost" className="rounded-xl border border-zinc-700 hover:bg-zinc-900">
                <Copy className="mr-2 h-4 w-4" /> Copy Invite Email
              </Button>
              <Button onClick={openInviteEmailClient} className="rounded-xl bg-blue-700 hover:bg-blue-600">
                <Mail className="mr-2 h-4 w-4" /> Open Email App
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function SubscriptionCompletePage() {
    const [secondsLeft, setSecondsLeft] = useState(10);
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const completedPlan = normalizePlan(params.get("stripe_plan") || currentUser?.pendingStripePlan || plan || "free");
    const completedBilling = normalizeBillingInterval(params.get("stripe_billing") || currentUser?.pendingStripeBillingInterval || billingInterval || "monthly");
    const planName = planLimits[completedPlan]?.name || "Subscriber";

    function goToDashboardNow() {
      setPage("dashboard");
      if (typeof window !== "undefined") {
        window.history.replaceState({}, document.title, "/");
        setPublicRoute("/");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }

    useEffect(() => {
      const countdown = window.setInterval(() => {
        setSecondsLeft((current) => Math.max(0, current - 1));
      }, 1000);
      const redirect = window.setTimeout(goToDashboardNow, 10000);
      return () => {
        window.clearInterval(countdown);
        window.clearTimeout(redirect);
      };
    }, []);

    return (
      <div className="relative min-h-screen overflow-x-hidden text-zinc-100">
        <AppBackground />
        <main className="relative z-10 mx-auto flex min-h-screen w-[95%] max-w-4xl items-center justify-center px-3 py-8 sm:px-6">
          <section className="w-full rounded-3xl border border-emerald-700/70 bg-black/70 p-6 text-center shadow-2xl backdrop-blur sm:p-10">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-emerald-500 bg-emerald-950/70 shadow-lg">
              <CalendarCheck className="h-10 w-10 text-emerald-300" />
            </div>
            <h1 className="mt-6 text-3xl font-black text-white sm:text-5xl">Thank you for subscribing!</h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg leading-8 text-zinc-300">
              Your Dungeon Calendar subscription is complete. Your {planName} plan is being verified and activated for {completedBilling} billing.
            </p>
            <div className="mx-auto mt-6 max-w-xl rounded-2xl border border-zinc-700 bg-zinc-950/70 p-5 text-left">
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-emerald-300">What happens next</p>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-zinc-300">
                <li>✓ Your paid features will unlock on your account after Stripe verification finishes.</li>
                <li>✓ You can manage campaigns, availability, calendar tools, and billing from your dashboard.</li>
                <li>✓ If activation takes a moment, use Billing → Verify Stripe Subscription.</li>
              </ul>
            </div>
            <p className="mt-6 text-sm font-semibold text-zinc-400">
              Redirecting to your dashboard in <span className="text-emerald-300">{secondsLeft}</span> seconds.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button onClick={goToDashboardNow} className="rounded-xl bg-emerald-700 px-6 py-3 hover:bg-emerald-600">
                Go to Dashboard Now
              </Button>
              <Button onClick={() => navigateTo("/about")} variant="ghost" className="rounded-xl border border-zinc-700 px-6 py-3 hover:bg-zinc-900">
                About Dungeon Calendar
              </Button>
            </div>
            <LegalLinks className="mt-6" />
          </section>
        </main>
      </div>
    );
  }

  function PageContent() {
    if (page === "dashboard") return DashboardPage();
    if (page === "calendar") return CalendarGrid();
    if (page === "results") return ResultsPage();
    if (page === "settings") return SettingsPage();
    if (page === "account") return AccountSettingsPage();
    if (page === "billing") return BillingPage();
    return DashboardPage();
  }

  if (publicRoute === "/about") {
    return AboutPage();
  }

  if (publicRoute === "/subscription-complete") {
    return <SubscriptionCompletePage />;
  }

  if (!authProfileLoaded) {
    return <div className="relative min-h-screen w-full overflow-x-hidden overflow-y-auto text-zinc-100"><AppBackground /><main className="relative z-10 mx-auto flex min-h-screen w-full items-center justify-center px-3 py-5"><div className="rounded-2xl border border-zinc-800 bg-black/70 px-6 py-5 text-center shadow-2xl"><p className="text-lg font-bold">Loading Dungeon Calendar...</p><p className="mt-2 text-sm text-zinc-400">Restoring your Firebase session.</p></div></main></div>;
  }

  if (!currentUser) {
    return <div className="relative min-h-screen w-full overflow-x-hidden overflow-y-auto text-zinc-100"><AppBackground /><main className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-3 py-5 sm:px-6 sm:py-10"><div className="w-full max-w-xl">{Sidebar}</div></main></div>;
  }

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden overflow-y-auto text-zinc-100">
      <AppBackground />
      <main className="relative z-10 mx-auto grid min-h-screen w-full max-w-[1600px] gap-4 overflow-visible px-3 py-4 sm:px-5 sm:py-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6 lg:px-6">
        {Sidebar}
        <section className="w-full min-w-0 space-y-4 sm:space-y-5">
          {Header}
          {PageContent()}
          <footer className="rounded-2xl border border-zinc-800 bg-black/35 px-4 py-3 backdrop-blur">
            <LegalLinks />
          </footer>
        </section>
      </main>
      <EmailInvitePopup />
    </div>
  );
}
