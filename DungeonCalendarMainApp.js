import React, { useEffect, useMemo, useState } from "react";
import { EmailAuthProvider, GoogleAuthProvider, createUserWithEmailAndPassword, onAuthStateChanged, reauthenticateWithCredential, signInWithEmailAndPassword, signInWithPopup, signOut, updateEmail, updatePassword } from "firebase/auth";
import { doc, getDoc, getFirestore, setDoc } from "firebase/firestore";
import app, { auth } from "./firebase";
import { BarChart3, CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, Copy, Home, LogIn, LogOut, Mail, MessageSquare, Plus, Settings, Shield, Trash2, UserCheck, Users, Zap } from "lucide-react";
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

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "players", label: "Players", icon: Users },
  { id: "results", label: "Results", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings }
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

function dateKey(date) {
  return date.toISOString().slice(0, 10);
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
  if (isChosenDate) return "bg-emerald-500 text-black ring-4 ring-emerald-200 shadow-[0_0_28px_rgba(52,211,153,0.75)]";
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

const db = getFirestore(app);

function normalizeEmail(email = "") {
  return email.trim().toLowerCase();
}

async function loadUserProfile(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    console.warn("Firestore profile load failed; continuing with Firebase Auth only:", error);
    return null;
  }
}

async function saveUserProfile(uid, profile) {
  try {
    await setDoc(doc(db, "users", uid), profile, { merge: true });
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
  if (code === "auth/popup-closed-by-user") return "Google sign-in was cancelled before it finished.";
  if (code === "auth/popup-blocked") return "Your browser blocked the Google sign-in popup. Allow popups for this site and try again.";
  if (code === "auth/unauthorized-domain") return "This domain is not authorized for Firebase login. Add dungeoncalendar.com and www.dungeoncalendar.com in Firebase Authentication > Settings > Authorized domains.";
  if (code === "auth/operation-not-allowed") return "Google sign-in is not enabled. Open Firebase Console > Authentication > Sign-in method and enable Google.";
  return error?.message || "Authentication failed.";
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
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [players, setPlayers] = useState(() => {
    const savedPlayers = localStorage.getItem("dnd-calendar-players");
    return savedPlayers ? JSON.parse(savedPlayers) : defaultPlayers;
  });
  const [currentUserId, setCurrentUserId] = useState(() => localStorage.getItem("dnd-calendar-current-user") || "");
  const [activePlayerId, setActivePlayerId] = useState(() => localStorage.getItem("dnd-calendar-active-player") || "");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginName, setLoginName] = useState("");
  const [campaignCharacterNames, setCampaignCharacterNames] = useState({});
  const [loginError, setLoginError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authProfileLoaded, setAuthProfileLoaded] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem("dnd-calendar-remember-me") === "true");
  const [authMode, setAuthMode] = useState("login");
  const [availabilityMode, setAvailabilityMode] = useState("available");
  const [campaigns, setCampaigns] = useState(() => {
    const savedCampaigns = localStorage.getItem("dnd-calendar-campaigns");
    return savedCampaigns ? JSON.parse(savedCampaigns) : [createCampaign()];
  });
  const [activeCampaignId, setActiveCampaignId] = useState(() => localStorage.getItem("dnd-calendar-active-campaign") || "");
  const [newPlayer, setNewPlayer] = useState("");
  const [newPlayerEmail, setNewPlayerEmail] = useState("");
  const [newPlayerPhone, setNewPlayerPhone] = useState("");
  const [copied, setCopied] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [accountUsername, setAccountUsername] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [editingField, setEditingField] = useState("");
  const [showPasswordVerify, setShowPasswordVerify] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState("");
  const [plan, setPlan] = useState("free");
  const [billingMessage, setBillingMessage] = useState("");
  const [selectedPaymentPlan, setSelectedPaymentPlan] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [paymentName, setPaymentName] = useState("");
  const [paymentEmail, setPaymentEmail] = useState("");
  const [paymentCardNumber, setPaymentCardNumber] = useState("");
  const [paymentExpiry, setPaymentExpiry] = useState("");
  const [paymentCvc, setPaymentCvc] = useState("");

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
      price: "$0"
    },
    adventurer: {
      name: "Adventurer",
      campaigns: 5,
      price: "$2.99"
    },
    guildmaster: {
      name: "Guildmaster",
      campaigns: Infinity,
      price: "$4.99"
    }
  };

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

  function updatePlayerToken(playerId, file, campaignId = activeCampaign?.id) {
    if (!file || !campaignId) return;

    if (!hasPlanFeature("tokenUploads")) {
      setBillingMessage("Custom player token images are included with the Guildmaster plan.");
      setPage("billing");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPlayers((current) => current.map((player) => player.id === playerId ? {
        ...player,
        campaignTokenImages: {
          ...(player.campaignTokenImages || {}),
          [campaignId]: reader.result
        }
      } : player));
    };
    reader.readAsDataURL(file);
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
  }

  const activeCampaign = campaigns.find((campaign) => campaign.id === activeCampaignId) ?? campaigns[0];
  const availability = activeCampaign?.availability ?? {};
  const unavailable = activeCampaign?.unavailable ?? {};
  const dungeonMasterIds = activeCampaign?.dungeonMasterIds ?? [];
  const campaignName = activeCampaign?.name ?? "";
  const isEditingCampaignName = activeCampaign?.isEditingName ?? true;
  const chosenDate = activeCampaign?.chosenDate ?? "";
  const sessionTime = activeCampaign?.sessionTime ?? "18:00";
  const sessionDuration = activeCampaign?.sessionDuration ?? 4;
  const reminderHours = activeCampaign?.reminderHours ?? 24;
  const dates = useMemo(() => buildMonth(viewDate.getFullYear(), viewDate.getMonth()), [viewDate]);
  const currentUser = players.find((player) => player.id === currentUserId);
  const activePlayer = players.find((player) => player.id === activePlayerId);
  const isDungeonMaster = !!currentUser && !!activeCampaign?.dungeonMasterIds?.includes(currentUser.id);
  const activeCampaignRole = isDungeonMaster ? "Dungeon Master" : "Player";
  const activeCampaignPlayers = useMemo(() => {
    const relevantPlayers = players.filter((player) =>
      (player.campaignIds ?? []).includes(activeCampaign?.id) ||
      activeCampaign?.dungeonMasterIds?.includes(player.id)
    );

    return relevantPlayers.filter((player, index, list) => {
      const key = player.email?.toLowerCase() || player.name?.toLowerCase() || player.id;
      const matchingPlayers = list.filter((candidate) =>
        (candidate.email?.toLowerCase() || candidate.name?.toLowerCase() || candidate.id) === key
      );
      const matchingDungeonMaster = matchingPlayers.find((candidate) => activeCampaign?.dungeonMasterIds?.includes(candidate.id));

      if (matchingDungeonMaster) return player.id === matchingDungeonMaster.id;
      return index === list.findIndex((candidate) =>
        (candidate.email?.toLowerCase() || candidate.name?.toLowerCase() || candidate.id) === key
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
        setAuthProfileLoaded(true);
        return;
      }

      try {
        const profile = await loadUserProfile(user.uid);
        const localMatch = players.find((player) =>
          player.id === user.uid || normalizeEmail(player.email) === normalizeEmail(user.email || "")
        );
        const firebasePlayer = firebaseProfileToPlayer(user.uid, profile || localMatch || {}, user.email || "");

        setPlayers((current) => {
          const withoutDuplicate = current.filter((player) =>
            player.id !== user.uid && normalizeEmail(player.email) !== normalizeEmail(firebasePlayer.email)
          );
          return [...withoutDuplicate, firebasePlayer];
        });

        setCurrentUserId(user.uid);
        setActivePlayerId(user.uid);
        if (firebasePlayer.campaignIds?.[0]) setActiveCampaignId(firebasePlayer.campaignIds[0]);
      } catch (error) {
        console.error("Failed to restore Firebase login:", error);
      } finally {
        setAuthProfileLoaded(true);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!authProfileLoaded || !currentUserId || !currentUser || auth.currentUser?.uid !== currentUserId) return;

    saveUserProfile(currentUserId, {
      role: currentUser.role || "Player",
      username: currentUser.username || "",
      name: currentUser.name || "",
      email: normalizeEmail(currentUser.email || ""),
      phone: currentUser.phone || "",
      campaignIds: currentUser.campaignIds || [],
      campaignCharacterNames: currentUser.campaignCharacterNames || {},
      lockedColorCampaignIds: currentUser.lockedColorCampaignIds || [],
      color: currentUser.color || "",
      campaignTokenImages: currentUser.campaignTokenImages || {}
    }).catch((error) => console.error("Failed to sync web profile:", error));
  }, [authProfileLoaded, currentUserId, currentUser]);

  useEffect(() => {
    localStorage.setItem("dnd-calendar-players", JSON.stringify(players));
  }, [players]);

  useEffect(() => {
    localStorage.setItem("dnd-calendar-campaigns", JSON.stringify(campaigns));
  }, [campaigns]);

  useEffect(() => {
    localStorage.setItem("dnd-calendar-current-user", currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    localStorage.setItem("dnd-calendar-active-player", activePlayerId);
  }, [activePlayerId]);

  useEffect(() => {
    localStorage.setItem("dnd-calendar-active-campaign", activeCampaignId);
  }, [activeCampaignId]);

  useEffect(() => {
    if (!activeCampaignId && campaigns[0]) {
      setActiveCampaignId(campaigns[0].id);
    }
  }, [activeCampaignId, campaigns]);

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
    if (currentUser) {
      setAccountUsername(currentUser.username ?? "");
      setAccountName(currentUser.name ?? "");
      setAccountPhone(currentUser.phone ?? "");
      setAccountEmail(currentUser.email ?? "");
      setAccountPassword("");
      setAccountMessage("");
    }
  }, [currentUser]);

  const bestDates = useMemo(() => {
    return Object.entries(availability)
      .map(([key, ids]) => ({ key, count: ids.length, names: ids.map((id) => { const player = players.find((p) => p.id === id); return player?.campaignCharacterNames?.[activeCampaign?.id] || player?.name; }).filter(Boolean) }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }, [availability, players]);

  const selectedDateLabel = chosenDate ? new Date(chosenDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "No sessions scheduled yet.";

  function updateActiveCampaign(updater) {
    setCampaigns((current) => current.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, ...updater(campaign) } : campaign));
  }

  async function login() {
    if (authBusy) return;
    setAuthBusy(true);
    setLoginError("");
    localStorage.setItem("dnd-calendar-remember-me", rememberMe ? "true" : "false");
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
      let uid = "";
      let player;

      if (authMode === "login") {
        const credential = await signInWithEmailAndPassword(auth, trimmedEmail, loginPassword);
        uid = credential.user.uid;
        const profile = await loadUserProfile(uid);
        const existingLocal = players.find((item) => item.id === uid || normalizeEmail(item.email) === trimmedEmail);

        player = {
          ...firebaseProfileToPlayer(uid, profile || existingLocal || {}, trimmedEmail),
          color: profile?.color || existingLocal?.color || playerColors.find((color) => !players.some((item) => item.color === color)) || playerColors[0],
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
          campaignTokenImages: existingInvite?.campaignTokenImages || {},
          lockedColorCampaignIds: existingInvite?.lockedColorCampaignIds || []
        };

        await saveUserProfile(uid, player);
      }

      setPlayers((current) => {
        const withoutDuplicate = current.filter((item) => item.id !== uid && normalizeEmail(item.email) !== trimmedEmail);
        return [...withoutDuplicate, player];
      });

      if (rememberMe) {
        localStorage.setItem("dnd-calendar-current-user", uid);
        localStorage.setItem("dnd-calendar-active-player", uid);
      }

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

  async function loginWithGoogle() {
    if (authBusy) return;
    setAuthBusy(true);
    setLoginError("");
    localStorage.setItem("dnd-calendar-remember-me", rememberMe ? "true" : "false");

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
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
        campaignIds: profile?.campaignIds || existingLocal?.campaignIds || (activeCampaign?.id ? [activeCampaign.id] : []),
        campaignCharacterNames: profile?.campaignCharacterNames || existingLocal?.campaignCharacterNames || (activeCampaign?.id ? { [activeCampaign.id]: "" } : {})
      };

      await saveUserProfile(uid, player);

      setPlayers((current) => {
        const withoutDuplicate = current.filter((item) => item.id !== uid && normalizeEmail(item.email) !== email);
        return [...withoutDuplicate, player];
      });

      if (rememberMe) {
        localStorage.setItem("dnd-calendar-current-user", uid);
        localStorage.setItem("dnd-calendar-active-player", uid);
      }

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

    localStorage.removeItem("dnd-calendar-remember-me");
    setCurrentUserId("");
    setActivePlayerId("");
    localStorage.removeItem("dnd-calendar-current-user");
    localStorage.removeItem("dnd-calendar-active-player");
    setLoginEmail("");
    setLoginPassword("");
    setLoginName("");
    setCampaignCharacterNames({});
  }

  function startPlanCheckout(planId) {
    if (planId === "free") {
      setPlan("free");
      setSelectedPaymentPlan("");
      setBillingMessage("Free plan selected.");
      return;
    }

    setSelectedPaymentPlan(planId);
    setPaymentName(currentUser?.name ?? "");
    setPaymentEmail(currentUser?.email ?? "");
    setBillingMessage("");
  }

  function completePayment() {
    if (!selectedPaymentPlan) return;

    if (!paymentName.trim() || !paymentEmail.trim()) {
      setBillingMessage("Enter your billing name and email.");
      return;
    }

    if (paymentMethod === "card" && (!paymentCardNumber.trim() || !paymentExpiry.trim() || !paymentCvc.trim())) {
      setBillingMessage("Enter your card number, expiration date, and CVC.");
      return;
    }

    setPlan(selectedPaymentPlan);
    setSelectedPaymentPlan("");
    setPaymentCardNumber("");
    setPaymentExpiry("");
    setPaymentCvc("");
    setBillingMessage(`${planLimits[selectedPaymentPlan].name} plan activated. Replace this demo payment form with Stripe Checkout before accepting real payments.`);
  }

  function cancelCurrentPlan() {
    if (plan === "free") {
      setAccountMessage("You are already on the Free plan.");
      return;
    }

    const confirmed = window.confirm("Cancel your current paid membership and switch to the Free plan?");
    if (!confirmed) return;

    setPlan("free");
    setSelectedPaymentPlan("");
    setBillingMessage("Membership cancelled. Free plan is now active.");
    setAccountMessage("Membership cancelled. You are now on the Free plan.");
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
    const campaign = createCampaign("", [currentUser.id], currentUser.id);
    setCampaigns((current) => [...current, campaign]);
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

    setPlayers((current) => current.map((player) => {
      if (player.id !== currentUser.id) return player;
      return { ...player, campaignIds: (player.campaignIds ?? []).filter((id) => id !== campaignId) };
    }));

    if (activeCampaignId === campaignId) {
      const nextCampaign = campaigns.find((campaign) => campaign.id !== campaignId);
      if (nextCampaign) setActiveCampaignId(nextCampaign.id);
    }
  }

  function addPlayer() {
    const trimmed = newPlayer.trim();
    if (!trimmed || !isDungeonMaster) return;
    if (players.some((player) => player.name.toLowerCase() === trimmed.toLowerCase())) return;
    const player = { id: crypto.randomUUID(), role: "Player", name: trimmed, email: newPlayerEmail.trim(), password: "dndplayer", phone: newPlayerPhone.trim(), campaignIds: activeCampaign?.id ? [activeCampaign.id] : [], campaignCharacterNames: activeCampaign?.id ? { [activeCampaign.id]: "" } : {}, color: playerColors[players.length % playerColors.length] };
    setPlayers((current) => [...current, player]);
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

  async function verifyCurrentPassword() {
    if (!auth.currentUser?.email) {
      setAccountMessage("Sign in again before changing your password.");
      return;
    }

    if (!currentPasswordInput.trim()) {
      setAccountMessage("Enter your current password.");
      return;
    }

    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPasswordInput);
      await reauthenticateWithCredential(auth.currentUser, credential);
      setShowPasswordVerify(false);
      setCurrentPasswordInput("");
      setAccountPassword("");
      setEditingField("password");
      setAccountMessage("Current password verified. Enter your new password, then click Save Changes.");
    } catch (error) {
      setAccountMessage("Current password is incorrect.");
    }
  }

  async function saveAccountSettings() {
    if (!currentUser) return;

    const nextUsername = accountUsername.trim();
    const nextName = accountName.trim();
    const nextEmail = normalizeEmail(accountEmail);

    if (!nextUsername || !nextName || !nextEmail) {
      setAccountMessage("Username, name, and email are required.");
      return;
    }

    const emailUsed = players.some((player) => player.id !== currentUser.id && normalizeEmail(player.email) === nextEmail);
    if (emailUsed) {
      setAccountMessage("That email is already used by another account.");
      return;
    }

    try {
      if (editingField === "password") {
        if (!accountPassword.trim()) {
          setAccountMessage("Enter a new password before saving.");
          return;
        }
        await updatePassword(auth.currentUser, accountPassword);
      }

      if (auth.currentUser && nextEmail !== normalizeEmail(auth.currentUser.email || "")) {
        await updateEmail(auth.currentUser, nextEmail);
      }

      const updatedProfile = {
        ...currentUser,
        username: nextUsername,
        name: nextName,
        phone: accountPhone.trim(),
        email: nextEmail,
        password: ""
      };

      await saveUserProfile(currentUser.id, {
        role: updatedProfile.role || "Player",
        username: updatedProfile.username || "",
        name: updatedProfile.name || "",
        email: normalizeEmail(updatedProfile.email || ""),
        phone: updatedProfile.phone || "",
        campaignIds: updatedProfile.campaignIds || [],
        campaignCharacterNames: updatedProfile.campaignCharacterNames || {},
        lockedColorCampaignIds: updatedProfile.lockedColorCampaignIds || [],
        color: updatedProfile.color || "",
        campaignTokenImages: updatedProfile.campaignTokenImages || {}
      });

      setPlayers((current) => current.map((player) => player.id === currentUser.id ? updatedProfile : player));

      setEditingField("");
      setAccountPassword("");
      setAccountMessage(editingField === "password" ? "Password changed and account settings saved." : "Account settings saved.");
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
      setAccountMessage("Account settings could not be saved. Please try again.");
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
    if (!isDungeonMaster) return;
    setPlayers((current) => current.filter((player) => player.id !== id));
    setCampaigns((current) => current.map((campaign) => ({
      ...campaign,
      availability: Object.fromEntries(Object.entries(campaign.availability).map(([key, ids]) => [key, ids.filter((playerId) => playerId !== id)]))
    })));
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
        return {
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

  function chooseBestDateAutomatically() {
    if (!isDungeonMaster) return;

    if (!hasPlanFeature("autoPick")) {
      setBillingMessage("Automatic best-date voting is available on Adventurer and Guildmaster plans.");
      setPage("billing");
      return;
    }

    const eligibleDates = Object.entries(availability)
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

  const Sidebar = (
    <aside className="rounded-2xl border border-red-900/60 bg-black/55 p-5 shadow-[0_0_60px_rgba(0,0,0,0.7)] backdrop-blur-md">
      <DungeonCalendarLogo small />
      <div className="mt-5 text-center">
        <h1 className="text-2xl font-bold">Dungeon Calendar</h1>
        <p className="mt-2 text-sm text-zinc-300">Find a time for your next adventure.</p>
      </div>

      {currentUser && (
        <nav className="mt-7 space-y-2">
          {navItems.filter((item) => isDungeonMaster || (item.id !== "settings" && item.id !== "players")).map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => setPage(item.id)} className={classNames("flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition", page === item.id ? "bg-red-900/60 text-white" : "text-zinc-300 hover:bg-zinc-900/80 hover:text-white")}>
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

          <Button onClick={login} disabled={authBusy} className="w-full rounded-xl bg-gradient-to-r from-red-800 to-red-600 py-6 text-lg font-bold hover:from-red-700 hover:to-red-500">
            <LogIn className="mr-2 h-5 w-5" />
            {authBusy ? "Working..." : authMode === "login" ? "Log In" : "Create Account"}
          </Button>

          <Button onClick={loginWithGoogle} disabled={authBusy} variant="ghost" className="w-full rounded-xl border border-zinc-700 bg-white py-5 text-zinc-950 hover:bg-zinc-100">
            <span className="mr-2 text-lg font-black">G</span>
            {authBusy ? "Working..." : "Continue with Google"}
          </Button>
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
                {campaigns.map((campaign, index) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name || `Campaign ${index + 1}`}{!isDungeonMaster && !(currentUser.campaignIds ?? []).includes(campaign.id) ? " - Join" : ""}
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

          <Button onClick={logout} variant="ghost" className="w-full rounded-xl border border-zinc-700 py-5 text-zinc-100 hover:bg-zinc-900 hover:text-white"><LogOut className="mr-2 h-4 w-4" /> Log Out</Button>
        </div>
      )}
    </aside>
  );

  const Header = (
    <div className="grid items-start gap-4 md:grid-cols-[1fr_auto]">
      <div>
        <h2 className="text-4xl font-bold">
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
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="h-12 w-12 rounded-lg bg-zinc-900 hover:bg-zinc-800 hover:text-white"><ChevronLeft /></Button>
              <div className="min-w-52 text-center text-2xl font-bold">{monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}</div>
              <Button variant="ghost" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="h-12 w-12 rounded-lg bg-zinc-900 hover:bg-zinc-800 hover:text-white"><ChevronRight /></Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-300">Marking as <span className="font-bold text-white">{activePlayer?.characterName || activePlayer?.name || currentUser?.campaignCharacterNames?.[activeCampaign?.id] || currentUser?.name}</span></p>

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
            <div className="grid grid-cols-7 bg-zinc-950/90">{dayNames.map((day) => <div key={day} className="px-2 py-4 text-center text-sm font-semibold text-zinc-400">{day}</div>)}</div>
            <div className="grid grid-cols-7">
              {dates.map((date) => {
                const key = dateKey(date);
                const ids = availability[key] ?? [];
                const hasDungeonMasterAvailable = ids.some((id) => isDungeonMasterResponse(id));
                const isChosenDate = key === chosenDate;
                const selectedByActive = ids.includes(activePlayerId);
                const unavailableIds = unavailable[key] ?? [];
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
                      compact ? "min-h-16 p-2" : "min-h-28 p-4",
                      "border-r border-t border-zinc-800 text-left transition",
                      isDungeonMaster || hasDungeonMasterAvailable ? "hover:bg-zinc-900" : "cursor-not-allowed opacity-35",
                      date.getMonth() !== viewDate.getMonth() && "text-zinc-600",
                      dateVisualState({ ids, unavailableIds, selectedByActive, unavailableByActive, hasDungeonMasterAvailable, hasDungeonMasterUnavailable, isChosenDate, isDungeonMaster })
                    )}
                  >
                    <div className="flex items-start justify-between"><span className="font-semibold">{date.getDate()}</span>{(hasDungeonMasterAvailable || hasDungeonMasterUnavailable || isChosenDate) && <Shield className="h-4 w-4" />}</div>
                    {!compact && hasDungeonMasterAvailable && !isChosenDate && <div className="mt-4 text-sm font-medium text-emerald-100">DM available</div>}
                    {!compact && hasDungeonMasterUnavailable && !isChosenDate && <div className="mt-4 text-sm font-medium text-red-100">DM not available</div>}
                    {!compact && !isDungeonMaster && !hasDungeonMasterAvailable && !hasDungeonMasterUnavailable && <div className="mt-4 text-xs font-semibold text-zinc-400">Waiting for DM</div>}
                    {!compact && isChosenDate && <div className="mt-4 rounded-md bg-emerald-300 px-2 py-1 text-center text-xs font-bold text-black">Final date</div>}
                    {!compact && visibleUnavailableIds.length > 0 && <div className="mt-3 space-y-1">{visibleUnavailableIds.map((id) => { const player = players.find((p) => p.id === id); return player ? <div key={id} title={isDungeonMaster ? player.name : ""} className="flex items-center gap-1.5 rounded-md bg-red-950/60 px-1.5 py-1 text-[11px] font-semibold text-red-100"><PlayerToken player={player} campaignId={activeCampaign?.id} size="sm" className="h-4 w-4 border-amber-300" /><span className="truncate">{isDungeonMasterResponse(player.id) ? "DM not available" : isDungeonMaster ? `${player?.campaignCharacterNames?.[activeCampaign?.id] || player?.name} unavailable` : "You unavailable"}</span></div> : null; })}</div>}
                    {!compact && visibleAvailableIds.length > 0 && <div className="mt-3 space-y-1">{visibleAvailableIds.map((id) => { const player = players.find((p) => p.id === id); return player ? <div key={id} title={isDungeonMaster ? player.name : ""} className="flex items-center gap-1.5 rounded-md bg-black/35 px-1.5 py-1 text-[11px] font-semibold text-white"><PlayerToken player={player} campaignId={activeCampaign?.id} size="sm" className="h-4 w-4 border-amber-300" /><span className="truncate">{isDungeonMasterResponse(player.id) ? "DM available" : isDungeonMaster ? player?.campaignCharacterNames?.[activeCampaign?.id] || player?.name : "You available"}</span></div> : null; })}</div>}
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
      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur">
          <CardContent className="space-y-3 p-6">
            <h2 className="text-2xl font-bold">Campaigns</h2>
            <p className="text-sm text-zinc-400">Join an existing campaign or create a new one.</p>

            <select
              value={activeCampaign?.id ?? ""}
              onChange={(event) => joinCampaign(event.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-black/50 px-3 py-3 outline-none ring-red-600/40 focus:ring-2"
            >
              {campaigns.map((campaign, index) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name || `Campaign ${index + 1}`}{!(currentUser?.campaignIds ?? []).includes(campaign.id) ? " - Join" : ""}
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
                        {player.email && <a href={`mailto:${player.email}?subject=${encodeURIComponent(`${campaignName} Dungeon Calendar scheduling invite`)}&body=${encodeURIComponent(getInviteMessage(player.name))}`} className="inline-flex items-center gap-1 rounded-lg bg-blue-700 px-2 py-1 text-xs font-bold"><Mail className="h-3 w-3" /> Email</a>}
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
    ])).sort((a, b) => {
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
                onKeyDown={(event) => event.key === "Enter" && saveAccountSettings()}
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
                    <p className="text-3xl font-black">{currentPlan.price}</p>
                    {plan !== "free" && <p className="text-sm text-zinc-400">per month</p>}
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
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Password</p>
                    {showPasswordVerify ? (
                      <div className="mt-3 rounded-xl border border-red-900 bg-red-950/30 p-4">
                        <p className="mb-3 text-sm text-zinc-300">Enter your current password to edit your password.</p>
                        <input
                          value={currentPasswordInput}
                          onChange={(event) => setCurrentPasswordInput(event.target.value)}
                          type="password"
                          placeholder="Current password"
                          className="w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 outline-none ring-red-600/40 focus:ring-2"
                        />
                        <div className="mt-3 flex gap-3">
                          <Button onClick={verifyCurrentPassword} className="rounded-xl bg-red-700 hover:bg-red-600">Verify Password</Button>
                          <Button onClick={() => { setShowPasswordVerify(false); setCurrentPasswordInput(""); setAccountMessage(""); }} variant="ghost" className="rounded-xl border border-zinc-700 hover:bg-zinc-900">Cancel</Button>
                        </div>
                      </div>
                    ) : editingField === "password" ? (
                      <input
                        value={accountPassword}
                        onChange={(event) => setAccountPassword(event.target.value)}
                        type="password"
                        className="mt-3 w-full min-w-[260px] rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 outline-none ring-red-600/40 focus:ring-2"
                        onKeyDown={(event) => event.key === "Enter" && saveAccountSettings()}
                      />
                    ) : (
                      <p className="mt-2 text-lg font-semibold tracking-[0.3em] text-zinc-100">••••••••</p>
                    )}
                  </div>
                  <Button
                    onClick={() => {
                      if (editingField === "password") {
                        setEditingField("");
                        return;
                      }
                      setShowPasswordVerify(true);
                      setCurrentPasswordInput("");
                    }}
                    variant="ghost"
                    className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900"
                  >
                    {editingField === "password" ? "Cancel" : "Change Password"}
                  </Button>
                </div>
              </div>

              {accountMessage && <p className="rounded-xl border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">{accountMessage}</p>}

              <div className="flex flex-wrap gap-3">
                <Button onClick={saveAccountSettings} className="rounded-xl bg-red-700 px-6 py-3 hover:bg-red-600">
                  Save Changes
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
              {campaigns.map((campaign, index) => {
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
    return <Card className="border-zinc-700 bg-black/55 text-zinc-100 backdrop-blur"><CardContent className="space-y-5 p-6"><h2 className="text-2xl font-bold">Campaign Settings</h2>{isDungeonMaster && <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"><label className="text-sm text-zinc-300">Campaign Name</label>{isEditingCampaignName ? <><input value={campaignName} onChange={(event) => updateActiveCampaign(() => ({ name: event.target.value }))} onKeyDown={(event) => event.key === "Enter" && updateActiveCampaign(() => ({ isEditingName: false }))} placeholder="Enter campaign name" className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3" /><Button onClick={() => updateActiveCampaign(() => ({ isEditingName: false }))} className="mt-3 rounded-xl bg-red-700 hover:bg-red-600">Save Campaign Name</Button></> : <div className="mt-3 flex items-center justify-between rounded-xl border border-zinc-700 bg-black/40 px-4 py-3"><span className="text-lg font-bold">{campaignName || "Unnamed Campaign"}</span><Button onClick={() => updateActiveCampaign(() => ({ isEditingName: true }))} variant="ghost" className="border border-zinc-700 hover:bg-zinc-900">Edit</Button></div>}</div>}<div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"><h3 className="font-bold">Session Defaults</h3><div className="mt-3 grid gap-3 md:grid-cols-3"><input type="time" value={sessionTime} onChange={(event) => updateActiveCampaign(() => ({ sessionTime: event.target.value }))} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className="rounded-xl border border-zinc-700 bg-black/60 px-3 py-2" /><input type="number" min="1" max="12" value={sessionDuration} onChange={(event) => updateActiveCampaign(() => ({ sessionDuration: event.target.value }))} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} className="rounded-xl border border-zinc-700 bg-black/60 px-3 py-2" /><select value={reminderHours} onChange={(event) => updateActiveCampaign(() => ({ reminderHours: event.target.value }))} className="rounded-xl border border-zinc-700 bg-black/60 px-3 py-2"><option value={1}>1 hour reminder</option><option value={6}>6 hours</option><option value={12}>12 hours</option><option value={24}>24 hours</option><option value={48}>2 days</option></select></div></div></CardContent></Card>;
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
              const ids = availability[key] ?? [];
              const unavailableIds = unavailable[key] ?? [];
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
      ...(isDungeonMaster ? [{ label: "Manage Players", description: "Invite, text, email, or remove players.", icon: Users, target: "players" }] : []),
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

              <Button
                onClick={() => plan !== "adventurer" && startPlanCheckout("adventurer")}
                disabled={plan === "adventurer"}
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

              <Button
                onClick={() => plan !== "guildmaster" && startPlanCheckout("guildmaster")}
                disabled={plan === "guildmaster"}
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
                    {planLimits[selectedPaymentPlan].name} Plan — {planLimits[selectedPaymentPlan].price}/month
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
                <label className="text-sm text-zinc-300">Payment Method</label>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {[
                    { id: "card", label: "Credit/Debit Card" },
                    {
                    id: "paypal", label: "PayPal"
                  },
                  {
                    id: "googlepay", label: "Google Pay"
                  },
                  {
                    id: "stripe", label: "Stripe"
                  },
                  {
                    id: "shopify", label: "Shopify"
                  },
                  {
                    id: "applepay", label: "Apple Pay"
                  }
                  ].map((method) => (
                    <button
                      key={method.id}
                      onClick={() => setPaymentMethod(method.id)}
                      className={classNames(
                        "rounded-xl border px-4 py-3 text-sm font-bold transition",
                        paymentMethod === method.id ? "border-amber-400 bg-amber-900/40 text-white" : "border-zinc-700 bg-black/40 text-zinc-300 hover:bg-zinc-900"
                      )}
                    >
                      {method.label}
                    </button>
                  ))}
                </div>
              </div>

              {paymentMethod === "card" ? (
                <div className="mt-5 grid gap-4 md:grid-cols-[2fr_1fr_1fr]">
                  <div>
                    <label className="text-sm text-zinc-300">Card Number</label>
                    <input
                      value={paymentCardNumber}
                      onChange={(event) => {
                        let value = event.target.value.replace(/\D/g, "");

                        const isAmex = /^3[47]/.test(value);
                        const maxLength = isAmex ? 15 : 16;
                        value = value.slice(0, maxLength);

                        let formatted = "";

                        if (isAmex) {
                          const parts = [
                            value.slice(0, 4),
                            value.slice(4, 10),
                            value.slice(10, 15)
                          ].filter(Boolean);

                          formatted = parts.join(" ");
                        } else {
                          formatted = value.match(/.{1,4}/g)?.join(" ") || value;
                        }

                        setPaymentCardNumber(formatted);
                      }}
                      placeholder="4242 4242 4242 4242"
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 outline-none ring-red-600/40 focus:ring-2"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-zinc-300">Exp.</label>
                    <input
                      value={paymentExpiry}
                      onChange={(event) => {
                        let value = event.target.value.replace(/\D/g, "").slice(0, 4);

                        if (value.length >= 3) {
                          value = `${value.slice(0, 2)}/${value.slice(2)}`;
                        }

                        setPaymentExpiry(value);
                      }}
                      placeholder="MM/YY"
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 outline-none ring-red-600/40 focus:ring-2"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-zinc-300">CVC</label>
                    <input
                      value={paymentCvc}
                      onChange={(event) => setPaymentCvc(event.target.value)}
                      placeholder="123"
                      className="mt-2 w-full rounded-xl border border-zinc-700 bg-black/50 px-4 py-3 outline-none ring-red-600/40 focus:ring-2"
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-xl border border-zinc-800 bg-black/40 p-4 text-sm text-zinc-300">
                  {paymentMethod === "paypal"
                    ? "PayPal checkout will open after you continue."
                    : paymentMethod === "googlepay"
                      ? "Google Pay checkout will open after you continue."
                      : paymentMethod === "stripe"
                        ? "Stripe secure checkout will open after you continue."
                        : paymentMethod === "shopify"
                          ? "Shopify payment checkout will open after you continue."
                          : "Apple Pay checkout will open after you continue."}
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-zinc-400">
                  Demo checkout only. Use Stripe Checkout, Shopify Payments, PayPal, Google Pay, or Apple Pay merchant setup before charging real customers.
                </p>
                <div className="flex flex-wrap gap-2">
                  {paymentMethod === "stripe" && (
                    <div className="rounded-xl border border-violet-700 bg-violet-950/40 px-3 py-2 text-xs font-semibold text-violet-200">
                      Stripe Secure Checkout Enabled
                    </div>
                  )}

                  {paymentMethod === "shopify" && (
                    <div className="rounded-xl border border-green-700 bg-green-950/40 px-3 py-2 text-xs font-semibold text-green-200">
                      Shopify Payments Connected
                    </div>
                  )}

                  <Button onClick={completePayment} className="rounded-xl bg-amber-600 hover:bg-amber-500">
                    Pay {planLimits[selectedPaymentPlan].price}/month
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  function PageContent() {
    if (page === "dashboard") return DashboardPage();
    if (page === "calendar") return CalendarGrid();
    if (page === "players") return PlayersPage();
    if (page === "results") return ResultsPage();
    if (page === "settings") return SettingsPage();
    if (page === "account") return AccountSettingsPage();
    if (page === "billing") return BillingPage();
    return DashboardPage();
  }

  if (!currentUser) {
    return <div className="relative min-h-screen overflow-hidden text-zinc-100"><AppBackground /><main className="relative z-10 mx-auto flex min-h-screen max-w-2xl items-center justify-center p-6"><div className="w-full max-w-xl">{Sidebar}</div></main></div>;
  }

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden overflow-y-auto text-zinc-100">
      <AppBackground />
      <main className="relative z-10 mx-auto grid min-h-screen w-full max-w-[1600px] justify-center gap-6 overflow-visible px-6 py-8 lg:grid-cols-[300px_minmax(0,1200px)]">
        {Sidebar}
        <section className="mx-auto w-full max-w-[1200px] space-y-5">
          {Header}
          {PageContent()}
        </section>
      </main>
    </div>
  );
}
