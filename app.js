"use strict";

// ======================================
// MODESSA - FINAL APP.JS
// Owner: Mohaddeseh | Companion: Hesam
// ======================================

// SUPABASE
const MODESSA_SUPABASE_URL = "https://hhdlqngktqmgqoxobzit.supabase.co";
const MODESSA_SUPABASE_KEY = "sb_publishable_8fmCWu3cDtERyO1mcJbwwg_25GneITj";

if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("Supabase library was not loaded. Check index.html.");
}

// ======================================
// TAB SESSION
// ======================================

let modessaTabId = sessionStorage.getItem("modessa_tab_id");

if (!modessaTabId) {
    modessaTabId = crypto.randomUUID();
    sessionStorage.setItem("modessa_tab_id", modessaTabId);
}

const modessaSupabase = window.supabase.createClient(
    MODESSA_SUPABASE_URL,
    MODESSA_SUPABASE_KEY,
    {
        auth: {
            storage: window.sessionStorage,
            storageKey: "modessa-auth-" + modessaTabId,
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    }
);

// ======================================
// ACCOUNT IDS
// ======================================

const MODESSA_OWNER_ID = "657a06ea-7a63-46fb-929f-8e21008736cb";
const MODESSA_COMPANION_ID = "d52a9a14-8bf2-4823-b990-66c152181272";
const STORAGE_KEY = "modessa_data_v1";

let currentUser = null;
let currentUserRole = "unknown";
let activeStorageKey = STORAGE_KEY;
let data = null;
let activeCompanionLink = null;
let companionMessages = [];
let companionUpdates = [];
let calendarDate = new Date();
let authSequence = 0;
let cloudSyncTimer = null;
let cloudSyncRunning = false;
let cloudSyncAgain = false;

const $ = id => document.getElementById(id);
const isOwnerUser = () => currentUserRole === "owner";
const isCompanionUser = () => currentUserRole === "companion";

function getUserRole(user = currentUser) {
    if (!user) return "unknown";
    if (user.id === MODESSA_OWNER_ID) return "owner";
    if (user.id === MODESSA_COMPANION_ID) return "companion";
    return "unknown";
}

function makeId() {
    return crypto?.randomUUID?.() ||
        "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === "x" ? r : (r & 3 | 8)).toString(16);
        });
}

function defaultData() {
    return {
        name: "محدثه",
        cycleLength: 28,
        periodDuration: 5,
        periods: [],
        symptoms: [],
        connectionCode: "",
        settings: {
            notifyStart: true,
            notifyNear: true,
            shareSymptoms: false
        }
    };
}

function loadLocalData(key) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || "null") || {};
        const defaults = defaultData();

        return {
            ...defaults,
            ...parsed,
            periods: Array.isArray(parsed.periods) ? parsed.periods : [],
            symptoms: Array.isArray(parsed.symptoms) ? parsed.symptoms : [],
            settings: {
                ...defaults.settings,
                ...(parsed.settings || {})
            }
        };
    } catch (e) {
        console.error("Local data:", e);
        return defaultData();
    }
}

function saveData() {
    if (!isOwnerUser() || !currentUser || !data) return;

    localStorage.setItem(activeStorageKey, JSON.stringify(data));
    scheduleCloudSync();
}

function toast(message) {
    const el = $("toast");
    if (!el) return;

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(toast.timer);

    toast.timer = setTimeout(() => {
        el.classList.remove("show");
    }, 2800);
}

function localDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDate(value) {
    if (!value) return new Date(NaN);

    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
}

function addDays(date, count) {
    const result = new Date(date);
    result.setDate(result.getDate() + count);
    return result;
}

function daysBetween(a, b) {
    return Math.round(
        (
            new Date(b.getFullYear(), b.getMonth(), b.getDate()) -
            new Date(a.getFullYear(), a.getMonth(), a.getDate())
        ) / 86400000
    );
}

function faDate(value) {
    const date = typeof value === "string" ? parseDate(value) : value;

    if (!date || Number.isNaN(date.getTime())) return "—";

    return new Intl.DateTimeFormat("fa-IR", {
        year: "numeric",
        month: "short",
        day: "numeric"
    }).format(date);
}

function faNumber(value) {
    return new Intl.NumberFormat("fa-IR").format(value);
}

function sortedPeriods() {
    return [...(data?.periods || [])].sort((a, b) =>
        a.start.localeCompare(b.start)
    );
}

function latestPeriod() {
    const list = sortedPeriods();
    return list.length ? list[list.length - 1] : null;
}

function nextPeriod() {
    const last = latestPeriod();

    return last
        ? addDays(parseDate(last.start), Number(data.cycleLength) || 28)
        : null;
}

function cycleDay() {
    const last = latestPeriod();

    return last
        ? daysBetween(parseDate(last.start), new Date()) + 1
        : null;
}

function setAuthenticated(session) {
    const loggedIn = !!session;

    document.body.classList.toggle("modessa-authenticated", loggedIn);

    if ($("auth-screen")) {
        $("auth-screen").hidden = loggedIn;
    }
}

// ======================================
// ROLE AND PAGE MANAGEMENT
// ======================================

function applyRoleUI() {
    const companionPage = $("companion-dashboard");

    const companionNav = document.querySelector(
        '.nav-item[data-page="companion-dashboard"]'
    );

    const ownerPages = [
        "dashboard",
        "calendar",
        "records",
        "symptoms",
        "companion",
        "profile"
    ];

    if (isCompanionUser()) {
        ownerPages.forEach(id => {
            if ($(id)) $(id).hidden = true;
        });

        if (companionPage) companionPage.hidden = false;
        if (companionNav) companionNav.hidden = false;

        document.querySelectorAll('.nav-item[data-page]').forEach(n => {
            n.hidden = n.dataset.page !== "companion-dashboard";
        });

        if ($("header-name")) {
            $("header-name").textContent = "حسام";
        }

        if ($("header-role")) {
            $("header-role").textContent = "همراه محدثه";
        }

        if ($("page-title")) {
            $("page-title").textContent = "داشبورد همراه";
        }

        showPage("companion-dashboard");

    } else if (isOwnerUser()) {
        ownerPages.forEach(id => {
            if ($(id)) $(id).hidden = false;
        });

        if (companionPage) companionPage.hidden = true;
        if (companionNav) companionNav.hidden = true;

        document.querySelectorAll('.nav-item[data-page]').forEach(n => {
            n.hidden = n.dataset.page === "companion-dashboard";
        });

        showPage("dashboard");
    }
}

function showPage(pageName) {
    if (!currentUser || !data) return;

    if (isCompanionUser()) {
        pageName = "companion-dashboard";
    }

    if (!isOwnerUser() && !isCompanionUser()) return;

    document.querySelectorAll(".page").forEach(page => {
        page.classList.remove("active");
    });

    document.querySelectorAll(".nav-item").forEach(item => {
        item.classList.remove("active");
    });

    const page = $(pageName);

    if (page) {
        page.hidden = false;
        page.classList.add("active");
    }

    const nav = document.querySelector(
        `.nav-item[data-page="${pageName}"]`
    );

    if (nav) nav.classList.add("active");

    const titles = {
        dashboard: "داشبورد",
        calendar: "تقویم قاعدگی",
        records: "تاریخچه",
        symptoms: "ثبت علائم",
        companion: "همراه من",
        profile: "پروفایل",
        "companion-dashboard": "داشبورد همراه"
    };

    if ($("page-title")) {
        $("page-title").textContent = titles[pageName] || "Modessa";
    }

    renderAll();
}

document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
        showPage(button.dataset.page);
    });
});

// ======================================
// OWNER DASHBOARD
// ======================================

function renderToday() {
    if ($("today-date")) {
        $("today-date").textContent =
            new Intl.DateTimeFormat("fa-IR", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric"
            }).format(new Date());
    }
}

function renderDashboard() {
    if (!isOwnerUser() || !data) return;

    const last = latestPeriod();
    const next = nextPeriod();
    const day = cycleDay();

    if ($("cycle-day")) {
        $("cycle-day").textContent =
            day === null ? "-" : faNumber(Math.max(1, day));
    }

    if ($("cycle-length")) {
        $("cycle-length").textContent =
            faNumber(Number(data.cycleLength) || 28);
    }

    if ($("last-period")) {
        $("last-period").textContent =
            last ? faDate(last.start) : "ثبت نشده";
    }

    if (next) {
        const remaining = daysBetween(new Date(), next);
        const left = Math.max(0, remaining);

        if ($("days-left")) {
            $("days-left").textContent = faNumber(left);
        }

        if ($("countdown-number")) {
            $("countdown-number").textContent = faNumber(left);
        }

        if ($("next-period-text")) {
            $("next-period-text").textContent =
                remaining < 0
                    ? "تاریخ پیش‌بینی‌شده گذشته است؛ با ثبت دوره جدید، پیش‌بینی به‌روز می‌شود."
                    : `شروع احتمالی پریود: ${faDate(next)}`;
        }

    } else {
        if ($("days-left")) $("days-left").textContent = "-";
        if ($("countdown-number")) $("countdown-number").textContent = "-";

        if ($("next-period-text")) {
            $("next-period-text").textContent =
                "برای دریافت پیش‌بینی، تاریخ شروع پریودت رو ثبت کن.";
        }
    }

    renderMiniCalendar();
}

function periodStatus(date) {
    const value = localDate(date);

    for (const p of data.periods) {
        if (value >= p.start && value <= p.end) {
            return "period";
        }
    }

    const next = nextPeriod();

    if (next) {
        const end = localDate(
            addDays(next, (Number(data.periodDuration) || 5) - 1)
        );

        if (value >= localDate(next) && value <= end) {
            return "future";
        }
    }

    return "";
}

function buildCalendar(id, date) {
    if (!isOwnerUser() || !data || !$(id)) return;

    const el = $(id);
    el.replaceChildren();

    ["ش", "ی", "د", "س", "چ", "پ", "ج"].forEach(label => {
        const cell = document.createElement("div");
        cell.className = "calendar-weekday";
        cell.textContent = label;
        el.appendChild(cell);
    });

    const year = date.getFullYear();
    const month = date.getMonth();

    const first = new Date(year, month, 1);
    const total = new Date(year, month + 1, 0).getDate();
    const offset = (first.getDay() + 1) % 7;
    const today = localDate(new Date());

    for (let i = 0; i < offset; i++) {
        const blank = document.createElement("div");
        blank.className = "calendar-day empty";
        el.appendChild(blank);
    }

    for (let day = 1; day <= total; day++) {
        const d = new Date(year, month, day);
        const cell = document.createElement("div");

        cell.className = "calendar-day";

        const status = periodStatus(d);

        if (status) cell.classList.add(status);
        if (localDate(d) === today) cell.classList.add("today");

        cell.textContent = faNumber(day);
        el.appendChild(cell);
    }
}

function renderMiniCalendar() {
    buildCalendar("mini-calendar", new Date());
}

function renderFullCalendar() {
    if (!isOwnerUser()) return;

    if ($("calendar-month")) {
        $("calendar-month").textContent =
            new Intl.DateTimeFormat("fa-IR", {
                year: "numeric",
                month: "long"
            }).format(calendarDate);
    }

    buildCalendar("full-calendar", calendarDate);
}

function changeMonth(amount) {
    if (!isOwnerUser()) return;

    calendarDate.setMonth(calendarDate.getMonth() + amount);
    renderFullCalendar();
}

// ======================================
// PERIOD FORM
// ======================================

if ($("period-form")) {
    $("period-form").addEventListener("submit", e => {
        e.preventDefault();

        if (!isOwnerUser() || !data) return;

        const start = $("period-start").value;
        const end = $("period-end").value;

        if (!start || !end) {
            toast("لطفاً هر دو تاریخ را وارد کن.");
            return;
        }

        if (end < start) {
            toast("تاریخ پایان نمی‌تواند قبل از شروع باشد.");
            return;
        }

        const duration =
            daysBetween(parseDate(start), parseDate(end)) + 1;

        if (duration > 10) {
            toast("مدت واردشده غیرمعمول است؛ تاریخ‌ها را بررسی کن.");
            return;
        }

        if (data.periods.some(p => start <= p.end && end >= p.start)) {
            toast("این تاریخ با یک دوره قبلی تداخل دارد.");
            return;
        }

        data.periods.push({
            id: makeId(),
            start,
            end
        });

        data.periods.sort((a, b) => a.start.localeCompare(b.start));

        saveData();
        e.target.reset();
        renderAll();

        toast("دوره با موفقیت ثبت شد 🌸");
    });
}

// ======================================
// RECORDS
// ======================================

function renderRecords() {
    if (!isOwnerUser() || !$("records-list")) return;

    const el = $("records-list");
    el.replaceChildren();

    const periods = sortedPeriods().reverse();

    if (!periods.length) {
        el.textContent = "هنوز دوره‌ای ثبت نشده است.";
        return;
    }

    periods.forEach(p => {
        const row = document.createElement("div");
        row.className = "record-item";

        const info = document.createElement("div");

        const title = document.createElement("strong");
        title.textContent = faDate(p.start);

        const detail = document.createElement("span");
        detail.textContent =
            `مدت: ${faNumber(daysBetween(parseDate(p.start), parseDate(p.end)) + 1)} روز`;

        info.append(title, detail);

        const del = document.createElement("button");
        del.className = "delete-btn";
        del.textContent = "حذف";

        del.addEventListener("click", async () => {
            if (!confirm("این دوره حذف شود؟")) return;

            const { error } = await modessaSupabase
                .from("period_logs")
                .delete()
                .eq("id", p.id)
                .eq("user_id", currentUser.id);

            if (error) {
                console.error(error);
                toast("حذف از فضای ابری انجام نشد.");
                return;
            }

            data.periods = data.periods.filter(x => x.id !== p.id);

            saveData();
            renderAll();
            toast("دوره حذف شد.");
        });

        row.append(info, del);
        el.appendChild(row);
    });
}

// ======================================
// SYMPTOMS - FIXED
// ======================================

if ($("symptom-form")) {
    $("symptom-form").addEventListener("submit", e => {
        e.preventDefault();

        if (!isOwnerUser() || !data) return;

        const form = e.currentTarget;

        const mood = form.querySelector(
            'input[name="mood"]:checked'
        );

        if (!mood) {
            toast("لطفاً وضعیت روحی خودت را انتخاب کن.");
            return;
        }

        // دریافت تمام checkbox های انتخاب شده از کل فرم
        const selected = [
            ...form.querySelectorAll('input[type="checkbox"]:checked')
        ]
            .map(input => input.value)
            .filter(Boolean);

        // حذف موارد تکراری
        const uniqueSymptoms = [...new Set(selected)];

        const today = localDate(new Date());

        // پیدا کردن اطلاعات قبلی امروز
        const existing = data.symptoms.find(
            item => item.date === today
        );

        // جلوگیری از رکورد تکراری در یک روز
        data.symptoms = data.symptoms.filter(
            item => item.date !== today
        );

        // ذخیره یک رکورد کامل برای امروز
        data.symptoms.push({
            id: existing?.id || makeId(),
            date: today,
            mood: mood.value,
            symptoms: uniqueSymptoms,
            note: $("symptom-note")?.value.trim() || ""
        });

        saveData();
        form.reset();
        renderSymptoms();

        toast("وضعیت امروز ثبت شد 💗");
    });
}

function renderSymptoms() {
    if (!isOwnerUser() || !$("symptom-history")) return;

    const el = $("symptom-history");
    el.replaceChildren();

    const list = [...data.symptoms].sort(
        (a, b) => b.date.localeCompare(a.date)
    );

    if (!list.length) {
        el.textContent = "هنوز وضعیتی ثبت نکرده‌ای.";
        return;
    }

    list.forEach(item => {
        const row = document.createElement("div");
        row.className = "symptom-item";

        row.style.display = "flex";
        row.style.flexDirection = "column";
        row.style.alignItems = "stretch";
        row.style.justifyContent = "flex-start";

        const title = document.createElement("strong");
        title.textContent = `حال روحی: ${item.mood || "ثبت نشده"}`;

        const detail = document.createElement("span");

        const symptoms = Array.isArray(item.symptoms)
            ? item.symptoms
            : [];

        detail.textContent = symptoms.length
            ? symptoms.join("، ")
            : "بدون علامت ثبت‌شده";

        const date = document.createElement("small");
        date.textContent = faDate(item.date);

        row.append(title, detail, date);

        if (item.note) {
            const note = document.createElement("p");
            note.textContent = item.note;
            row.appendChild(note);
        }

        el.appendChild(row);
    });
}

// ======================================
// PROFILE
// ======================================

function renderProfile() {
    if (!isOwnerUser() || !data) return;

    if ($("profile-name")) $("profile-name").value = data.name;
    if ($("profile-cycle")) $("profile-cycle").value = data.cycleLength;
    if ($("profile-duration")) $("profile-duration").value = data.periodDuration;

    ["profile-display-name", "header-name"].forEach(id => {
        if ($(id)) $(id).textContent = data.name;
    });

    if ($("welcome-name")) {
        $("welcome-name").textContent = data.name + " عزیز!";
    }

    document.querySelectorAll(".avatar,.profile-avatar").forEach(el => {
        el.textContent = data.name?.charAt(0) || "م";
    });
}

if ($("profile-form")) {
    $("profile-form").addEventListener("submit", e => {
        e.preventDefault();

        if (!isOwnerUser() || !data) return;

        const name = $("profile-name").value.trim();
        const cycle = Number($("profile-cycle").value);
        const duration = Number($("profile-duration").value);

        if (!name || cycle < 15 || cycle > 60 || duration < 1 || duration > 10) {
            toast("مقادیر واردشده معتبر نیستند.");
            return;
        }

        Object.assign(data, {
            name,
            cycleLength: cycle,
            periodDuration: duration
        });

        saveData();
        renderAll();

        toast("پروفایل به‌روزرسانی شد.");
    });
}

// ======================================
// COMPANION LINK AND DATA
// ======================================

async function fetchActiveCompanionLink() {
    if (!currentUser) return null;

    const uid = currentUser.id;

    const { data: links, error } = await modessaSupabase
        .from("companion_links")
        .select("id,owner_user_id,companion_user_id,status,share_symptoms,created_at")
        .eq("status", "active")
        .or(`owner_user_id.eq.${uid},companion_user_id.eq.${uid}`);

    if (error) throw error;

    if (!currentUser || currentUser.id !== uid) return null;

    activeCompanionLink = (links || []).find(x =>
        x.owner_user_id === uid || x.companion_user_id === uid
    ) || null;

    return activeCompanionLink;
}

function updateCompanionStatus(message) {
    ["companion-status", "companion-dashboard-status"].forEach(id => {
        const el = $(id);
        if (!el) return;

        el.textContent = message;
        el.classList.toggle("is-connected", !!activeCompanionLink);
        el.classList.toggle("is-disconnected", !activeCompanionLink);
    });
}

async function generateCode() {
    if (!isOwnerUser() || !currentUser) {
        toast("این قابلیت فقط برای صاحب حساب است.");
        return;
    }

    try {
        const { data: code, error } =
            await modessaSupabase.rpc("create_companion_invite");

        if (error) throw error;
        if (!code) throw new Error("کد دعوت از سرور دریافت نشد.");

        data.connectionCode = String(code);

        localStorage.setItem(
            activeStorageKey,
            JSON.stringify(data)
        );

        if ($("connection-code")) {
            $("connection-code").textContent = data.connectionCode;
        }

        toast("کد دعوت ساخته شد.");

    } catch (e) {
        console.error(e);
        toast(e.message || "ساخت کد دعوت انجام نشد.");
    }
}

function copyCode() {
    if (!isOwnerUser() || !data?.connectionCode) {
        toast("ابتدا یک کد بساز.");
        return;
    }

    navigator.clipboard?.writeText(data.connectionCode)
        .then(() => toast("کد کپی شد."))
        .catch(() => toast("کپی خودکار در این مرورگر ممکن نیست."));
}

async function redeemCompanionCode() {
    if (!isCompanionUser()) {
        toast("این قابلیت فقط برای حساب همراه است.");
        return;
    }

    const code = $("companion-code-input")?.value.trim().toUpperCase();

    if (!code) {
        toast("کد دعوت را وارد کن.");
        return;
    }

    try {
        const { error } = await modessaSupabase.rpc(
            "redeem_companion_invite",
            { p_code: code }
        );

        if (error) throw error;

        if ($("companion-code-input")) {
            $("companion-code-input").value = "";
        }

        await loadCompanionData();

        toast("اتصال همراه با موفقیت برقرار شد.");

    } catch (e) {
        console.error(e);
        toast(e.message || "اتصال انجام نشد؛ کد را بررسی کن.");
    }
}

async function disconnectCompanion() {
    if (!isOwnerUser() || !activeCompanionLink) {
        toast("اتصال فعالی پیدا نشد.");
        return;
    }

    if (!confirm("اتصال همراه قطع شود؟")) return;

    try {
        const { error } =
            await modessaSupabase.rpc("disconnect_companion");

        if (error) throw error;

        activeCompanionLink = null;
        companionMessages = [];
        companionUpdates = [];

        await loadCompanionData();
        renderCompanion();

        toast("اتصال همراه قطع شد.");

    } catch (e) {
        console.error(e);
        toast(e.message || "قطع اتصال انجام نشد.");
    }
}

function renderCompanion() {
    if (!isOwnerUser() || !data) return;

    if ($("connection-code")) {
        $("connection-code").textContent =
            data.connectionCode || "------";
    }

    if ($("notify-start")) {
        $("notify-start").checked = !!data.settings.notifyStart;
    }

    if ($("notify-near")) {
        $("notify-near").checked = !!data.settings.notifyNear;
    }

    if ($("share-symptoms")) {
        $("share-symptoms").checked =
            !!activeCompanionLink?.share_symptoms;

        $("share-symptoms").disabled = !activeCompanionLink;
    }

    const disconnect = document.querySelector(
        '#companion button[onclick="disconnectCompanion()"]'
    );

    if (disconnect) {
        disconnect.disabled = !activeCompanionLink;
    }

    renderCompanionMessages();
}

async function saveSettings() {
    if (!isOwnerUser() || !data) return;

    const enabled = !!$("share-symptoms")?.checked;

    data.settings = {
        notifyStart: !!$("notify-start")?.checked,
        notifyNear: !!$("notify-near")?.checked,
        shareSymptoms: enabled
    };

    saveData();

    if (!activeCompanionLink) {
        toast("تنظیمات ذخیره شد. ابتدا همراه را متصل کن.");
        renderCompanion();
        return;
    }

    try {
        const { error } = await modessaSupabase.rpc(
            "set_companion_symptom_sharing",
            {
                p_link_id: activeCompanionLink.id,
                p_enabled: enabled
            }
        );

        if (error) throw error;

        activeCompanionLink.share_symptoms = enabled;

        if (enabled) {
            const today = localDate(new Date());

            const todayLog = data.symptoms.find(
                x => x.date === today
            );

            if (todayLog) {
                const { error: publishError } =
                    await modessaSupabase.rpc(
                        "publish_companion_update",
                        { p_log_date: today }
                    );

                if (publishError) throw publishError;
            }
        }

        toast("تنظیمات ذخیره شد.");

        await refreshCompanionUpdates();
        renderCompanion();

    } catch (e) {
        console.error(e);
        toast(e.message || "ذخیره تنظیمات اشتراک‌گذاری ناموفق بود.");
    }
}

// ======================================
// COMPANION MESSAGES
// ======================================

function renderCompanionMessages() {
    [
        "companion-messages-owner",
        "companion-messages-companion",
        "companion-messages"
    ].forEach(id => {
        const el = $(id);
        if (!el) return;

        el.replaceChildren();
        el.classList.add("chat-messages");

        if (!activeCompanionLink) {
            const empty = document.createElement("div");
            empty.className = "chat-empty";
            empty.innerHTML = `
                <span>🔗</span>
                <strong>هنوز اتصالی برقرار نیست</strong>
                <p>برای شروع گفت‌وگو ابتدا اتصال همراه را برقرار کنید.</p>
            `;
            el.appendChild(empty);
            return;
        }

        if (!companionMessages.length) {
            const empty = document.createElement("div");
            empty.className = "chat-empty";
            empty.innerHTML = `
                <span>💌</span>
                <strong>اولین پیام رو بفرست!</strong>
                <p>اینجا قراره گفت‌وگوهای شما ثبت بشه.</p>
            `;
            el.appendChild(empty);
            return;
        }

        companionMessages.forEach(m => {
            const mine = m.sender_user_id === currentUser?.id;

            const row = document.createElement("div");
            row.className = `chat-message ${mine ? "mine" : "theirs"}`;

            const avatar = document.createElement("div");
            avatar.className = "chat-avatar";
            avatar.textContent = mine
                ? (isOwnerUser() ? "م" : "ح")
                : (isOwnerUser() ? "ح" : "م");

            const content = document.createElement("div");
            content.className = "chat-content";

            const sender = document.createElement("span");
            sender.className = "chat-sender";
            sender.textContent = mine
                ? "شما"
                : (isOwnerUser() ? "حسام" : "محدثه");

            const bubble = document.createElement("div");
            bubble.className = "chat-bubble";

            const body = document.createElement("p");
            body.textContent = m.body || "";
            bubble.appendChild(body);

            const meta = document.createElement("div");
            meta.className = "chat-meta";

            const time = document.createElement("small");

            time.textContent = m.created_at
                ? new Intl.DateTimeFormat("fa-IR", {
                    hour: "2-digit",
                    minute: "2-digit"
                }).format(new Date(m.created_at))
                : "";

            meta.appendChild(time);

            if (mine) {
                const receipt = document.createElement("span");
                receipt.className = `chat-receipt ${m.read_at ? "read" : ""}`;
                receipt.textContent = m.read_at ? "✓✓" : "✓";
                receipt.title = m.read_at ? "خوانده شده" : "ارسال شده";
                meta.appendChild(receipt);
            }

            content.append(sender, bubble, meta);

            if (mine) {
                row.append(content, avatar);
            } else {
                row.append(avatar, content);
            }

            el.appendChild(row);
        });

        requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight;
        });
    });
}

async function refreshCompanionMessages() {
    if (!currentUser || !activeCompanionLink) {
        companionMessages = [];
        renderCompanionMessages();
        return;
    }

    const uid = currentUser.id;
    const linkId = activeCompanionLink.id;

    const { data: messages, error } = await modessaSupabase
        .from("companion_messages")
        .select("id,link_id,sender_user_id,body,created_at,read_at")
        .eq("link_id", linkId)
        .order("created_at", { ascending: true });

    if (error) throw error;

    if (
        !currentUser ||
        currentUser.id !== uid ||
        activeCompanionLink?.id !== linkId
    ) return;

    companionMessages = messages || [];

    const unread = companionMessages
        .filter(m => m.sender_user_id !== uid && !m.read_at)
        .map(m => m.id);

    if (unread.length) {
        const { error: readError } = await modessaSupabase
            .from("companion_messages")
            .update({ read_at: new Date().toISOString() })
            .in("id", unread);

        if (readError) console.warn(readError);
    }

    renderCompanionMessages();
}

// ======================================
// COMPANION SHARED UPDATES
// ======================================

async function refreshCompanionUpdates() {
    const el = $("companion-shared-updates");
    if (!el) return;

    el.replaceChildren();

    if (
        !isCompanionUser() ||
        !activeCompanionLink ||
        !activeCompanionLink.share_symptoms
    ) {
        el.textContent =
            "در حال حاضر اطلاعاتی برای اشتراک‌گذاری در دسترس نیست.";

        companionUpdates = [];
        return;
    }

    const uid = currentUser.id;
    const linkId = activeCompanionLink.id;

    const { data: updates, error } = await modessaSupabase
        .from("companion_shared_updates")
        .select("id,link_id,owner_user_id,log_date,symptoms,mood,note,created_at")
        .eq("link_id", linkId)
        .order("log_date", { ascending: false });

    if (error) {
        console.error("Companion updates error:", error);
        throw error;
    }

    if (
        !currentUser ||
        currentUser.id !== uid ||
        activeCompanionLink?.id !== linkId
    ) return;

    companionUpdates = updates || [];

    if (!companionUpdates.length) {
        el.textContent = "هنوز وضعیتی به اشتراک گذاشته نشده است.";
        return;
    }

    companionUpdates.forEach(u => {
        const row = document.createElement("div");
        row.className = "symptom-item";

        row.style.display = "flex";
        row.style.flexDirection = "column";
        row.style.alignItems = "stretch";
        row.style.justifyContent = "flex-start";
        row.style.gap = "8px";

        const title = document.createElement("strong");
        title.textContent = `وضعیت ${faDate(u.log_date)}`;

        const mood = document.createElement("p");
        mood.textContent = `حال روحی: ${u.mood || "ثبت نشده"}`;

        const symptoms = document.createElement("p");

        let symptomList = u.symptoms;

        if (typeof symptomList === "string") {
            try {
                symptomList = JSON.parse(symptomList);
            } catch {
                symptomList = [symptomList];
            }
        }

        if (!Array.isArray(symptomList)) {
            symptomList = [];
        }

        symptoms.textContent = symptomList.length
            ? symptomList.join("، ")
            : "بدون علامت ثبت‌شده";

        row.append(title, mood, symptoms);

        // نمایش یادداشت محدثه برای حسام
        const noteText = String(u.note || "").trim();

        if (noteText) {
            const note = document.createElement("p");
            note.className = "companion-note";
            note.textContent = `حرف امروز محدثه: ${noteText}`;
            row.appendChild(note);
        }

        el.appendChild(row);
    });
}

// ======================================
// SEND COMPANION MESSAGE
// ======================================

async function sendCompanionMessage() {
    if (!currentUser || !activeCompanionLink) {
        toast("ابتدا اتصال همراه را برقرار کنید.");
        return;
    }

    const input = $(
        isCompanionUser()
            ? "companion-message-input-companion"
            : "companion-message-input-owner"
    );

    const body = input?.value.trim() || "";

    if (!body) {
        toast("متن پیام را بنویس.");
        return;
    }

    if (body.length > 2000) {
        toast("پیام نباید بیشتر از ۲۰۰۰ کاراکتر باشد.");
        return;
    }

    const uid = currentUser.id;
    const linkId = activeCompanionLink.id;

    try {
        const { error } = await modessaSupabase
            .from("companion_messages")
            .insert({
                link_id: linkId,
                sender_user_id: uid,
                body
            });

        if (error) throw error;

        if (!currentUser || currentUser.id !== uid) return;

        input.value = "";

        await refreshCompanionMessages();

        toast("پیام ارسال شد.");

    } catch (e) {
        console.error(e);
        toast(e.message || "ارسال پیام انجام نشد.");
    }
}

// ======================================
// LOAD COMPANION DATA
// ======================================

async function loadCompanionData() {
    if (!currentUser) return;

    const uid = currentUser.id;
    const role = currentUserRole;

    try {
        await fetchActiveCompanionLink();

        if (!currentUser || currentUser.id !== uid) return;

        updateCompanionStatus(
            activeCompanionLink
                ? (
                    role === "owner"
                        ? "یک همراه به حساب شما متصل است."
                        : "به حساب محدثه متصل هستید."
                )
                : (
                    role === "owner"
                        ? "هنوز هیچ همراهی متصل نشده است."
                        : "هنوز به حساب محدثه متصل نشده‌اید."
                )
        );

        await refreshCompanionMessages();

        if (!currentUser || currentUser.id !== uid) return;

        if (role === "companion") {
            await refreshCompanionUpdates();
        }

        if (role === "owner") {
            renderCompanion();
        }

    } catch (e) {
        console.error("Companion load:", e);

        if (!currentUser || currentUser.id !== uid) return;

        activeCompanionLink = null;
        companionMessages = [];
        companionUpdates = [];

        updateCompanionStatus("دریافت اطلاعات همراه انجام نشد.");

        renderCompanionMessages();

        if (role === "companion") {
            await refreshCompanionUpdates();
        }
    }
}

// ======================================
// CLOUD SYNC - OWNER ONLY
// ======================================

function scheduleCloudSync() {
    if (!isOwnerUser() || !currentUser) return;

    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(syncModessaToCloud, 800);
}

async function syncModessaToCloud() {
    if (!isOwnerUser() || !currentUser || !data) return;

    if (cloudSyncRunning) {
        cloudSyncAgain = true;
        return;
    }

    cloudSyncRunning = true;

    const uid = currentUser.id;

    try {
        const [pr, sr, profile, settings] = await Promise.all([
            modessaSupabase
                .from("period_logs")
                .select("id,start_date,end_date")
                .eq("user_id", uid),

            modessaSupabase
                .from("symptom_logs")
                .select("id,log_date,symptoms,mood,note")
                .eq("user_id", uid),

            modessaSupabase
                .from("profiles")
                .select("display_name")
                .eq("user_id", uid)
                .maybeSingle(),

            modessaSupabase
                .from("cycle_settings")
                .select("average_cycle_length,average_period_length")
                .eq("user_id", uid)
                .maybeSingle()
        ]);

        [pr, sr, profile, settings].forEach(r => {
            if (r.error) throw r.error;
        });

        if (!currentUser || currentUser.id !== uid) return;

        const remotePeriods = (pr.data || []).map(x => ({
            id: x.id,
            start: x.start_date,
            end: x.end_date
        }));

        const remoteSymptoms = (sr.data || []).map(x => ({
            id: x.id,
            date: x.log_date,
            symptoms: Array.isArray(x.symptoms)
                ? x.symptoms
                : [],
            mood: x.mood || "",
            note: x.note || ""
        }));

        // ادغام دوره‌ها
        const periodMap = new Map(
            remotePeriods.map(x => [x.id, x])
        );

        data.periods.forEach(x => periodMap.set(x.id, x));
        data.periods = [...periodMap.values()];

        // ادغام علائم بر اساس تاریخ
        const symptomMap = new Map(
            remoteSymptoms.map(x => [x.date, x])
        );

        const localSymptomsByDate = new Map();

        data.symptoms.forEach(item => {
            if (!item?.date) return;

            localSymptomsByDate.set(item.date, {
                ...item,
                symptoms: Array.isArray(item.symptoms)
                    ? item.symptoms
                    : []
            });
        });

        localSymptomsByDate.forEach((item, date) => {
            symptomMap.set(date, item);
        });

        data.symptoms = [...symptomMap.values()].sort(
            (a, b) => a.date.localeCompare(b.date)
        );

        if (profile.data?.display_name && data.name === "محدثه") {
            data.name = profile.data.display_name;
        }

        if (
            settings.data?.average_cycle_length &&
            data.cycleLength === 28
        ) {
            data.cycleLength = settings.data.average_cycle_length;
        }

        if (
            settings.data?.average_period_length &&
            data.periodDuration === 5
        ) {
            data.periodDuration = settings.data.average_period_length;
        }

        localStorage.setItem(
            activeStorageKey,
            JSON.stringify(data)
        );

        const latest = latestPeriod();
        const now = new Date().toISOString();

        const results = await Promise.all([
            modessaSupabase
                .from("profiles")
                .upsert({
                    user_id: uid,
                    display_name: data.name,
                    updated_at: now
                }, { onConflict: "user_id" }),

            modessaSupabase
                .from("cycle_settings")
                .upsert({
                    user_id: uid,
                    last_period_start: latest?.start || null,
                    average_cycle_length: Number(data.cycleLength) || 28,
                    average_period_length: Number(data.periodDuration) || 5,
                    updated_at: now
                }, { onConflict: "user_id" })
        ]);

        results.forEach(r => {
            if (r.error) throw r.error;
        });

        // ذخیره دوره‌ها
        if (data.periods.length) {
            const rows = data.periods.map(p => ({
                id: p.id,
                user_id: uid,
                start_date: p.start,
                end_date: p.end
            }));

            const { error } = await modessaSupabase
                .from("period_logs")
                .upsert(rows, { onConflict: "id" });

            if (error) throw error;
        }

        // ذخیره تمام علائم و یادداشت‌ها
        if (data.symptoms.length) {
            const rows = data.symptoms.map(s => {
                const remote = remoteSymptoms.find(
                    x => x.date === s.date
                );

                return {
                    id: remote?.id || s.id,
                    user_id: uid,
                    log_date: s.date,
                    symptoms: Array.isArray(s.symptoms)
                        ? s.symptoms
                        : [],
                    mood: s.mood || "",
                    note: s.note || ""
                };
            });

            const { error } = await modessaSupabase
                .from("symptom_logs")
                .upsert(rows, {
                    onConflict: "user_id,log_date"
                });

            if (error) throw error;
        }

        // انتشار وضعیت امروز برای حسام
        if (!currentUser || currentUser.id !== uid) return;

        if (
            activeCompanionLink &&
            activeCompanionLink.share_symptoms
        ) {
            const today = localDate(new Date());

            const todayLog = data.symptoms.find(
                item => item.date === today
            );

            if (todayLog) {
                const { error: publishError } =
                    await modessaSupabase.rpc(
                        "publish_companion_update",
                        {
                            p_log_date: today
                        }
                    );

                if (publishError) {
                    console.error(
                        "Companion update publish error:",
                        publishError
                    );
                }
            }
        }

        if (!currentUser || currentUser.id !== uid) return;

        renderAll();

    } catch (e) {
        console.error("Cloud sync:", e);

    } finally {
        cloudSyncRunning = false;

        if (cloudSyncAgain) {
            cloudSyncAgain = false;

            if (isOwnerUser()) {
                scheduleCloudSync();
            }
        }
    }
}

// ======================================
// AUTHENTICATION
// ======================================

let authMode = "login";

function changeAuthMode(mode) {
    authMode = mode;

    if ($("auth-message")) {
        $("auth-message").textContent = "";
        $("auth-message").className = "auth-message";
    }

    $("login-tab")?.classList.toggle("active", mode === "login");
    $("register-tab")?.classList.toggle("active", mode === "register");

    if ($("confirm-password-field")) {
        $("confirm-password-field").hidden = mode !== "register";
    }

    if ($("auth-confirm-password")) {
        $("auth-confirm-password").required = mode === "register";
    }

    if ($("auth-password")) {
        $("auth-password").autocomplete =
            mode === "login" ? "current-password" : "new-password";
    }

    if ($("auth-submit")) {
        $("auth-submit").textContent =
            mode === "login" ? "ورود به حساب" : "ساخت حساب کاربری";
    }
}

function authMessage(message, type = "") {
    if (!$("auth-message")) return;

    $("auth-message").textContent = message;
    $("auth-message").className = "auth-message " + type;
}

$("login-tab")?.addEventListener("click", () => {
    changeAuthMode("login");
});

$("register-tab")?.addEventListener("click", () => {
    changeAuthMode("register");
});

// ======================================
// ACTIVATE USER
// ======================================

async function activateUser(session) {
    const sequence = ++authSequence;
    const user = session?.user || null;

    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = null;

    cloudSyncRunning = false;
    cloudSyncAgain = false;

    activeCompanionLink = null;
    companionMessages = [];
    companionUpdates = [];

    currentUser = user;
    currentUserRole = getUserRole(user);

    if (!user) {
        data = null;
        activeStorageKey = STORAGE_KEY;

        setAuthenticated(null);

        document.querySelectorAll(".page").forEach(p => {
            p.classList.remove("active");
            p.hidden = false;
        });

        const c = $("companion-dashboard");
        if (c) c.hidden = true;

        const n = document.querySelector(
            '.nav-item[data-page="companion-dashboard"]'
        );

        if (n) n.hidden = true;

        return;
    }

    setAuthenticated(session);

    if (currentUserRole === "unknown") {
        data = null;

        document.querySelectorAll(".page").forEach(p => {
            p.classList.remove("active");
            p.hidden = true;
        });

        toast("این حساب برای Modessa تعریف نشده است.");
        return;
    }

    activeStorageKey = STORAGE_KEY + "_" + user.id;

    if (isCompanionUser()) {
        data = defaultData();

    } else {
        const saved = localStorage.getItem(activeStorageKey);

        if (saved) {
            data = loadLocalData(activeStorageKey);

        } else {
            const legacy = localStorage.getItem(STORAGE_KEY);

            data = legacy
                ? loadLocalData(STORAGE_KEY)
                : defaultData();

            localStorage.setItem(
                activeStorageKey,
                JSON.stringify(data)
            );

            if (legacy) {
                localStorage.removeItem(STORAGE_KEY);
            }
        }

        let changed = false;

        [...data.periods, ...data.symptoms].forEach(item => {
            if (!item.id || typeof item.id !== "string") {
                item.id = makeId();
                changed = true;
            }
        });

        if (changed) {
            localStorage.setItem(
                activeStorageKey,
                JSON.stringify(data)
            );
        }
    }

    if (
        sequence !== authSequence ||
        currentUser?.id !== user.id
    ) return;

    applyRoleUI();
    renderToday();

    if (isCompanionUser()) {
        await loadCompanionData();

        if (
            sequence !== authSequence ||
            currentUser?.id !== user.id
        ) return;

        renderAll();

    } else {
        renderAll();

        await loadCompanionData();

        if (
            sequence !== authSequence ||
            currentUser?.id !== user.id
        ) return;

        await syncModessaToCloud();
    }
}

// ======================================
// LOGIN / REGISTER FORM
// ======================================

$("auth-form")?.addEventListener("submit", async e => {
    e.preventDefault();

    const email = $("auth-email").value.trim();
    const password = $("auth-password").value;
    const confirm = $("auth-confirm-password").value;

    if (password.length < 6) {
        authMessage("رمز عبور باید حداقل ۶ کاراکتر باشد.", "error");
        return;
    }

    if (authMode === "register" && password !== confirm) {
        authMessage("رمزهای عبور با هم مطابقت ندارند.", "error");
        return;
    }

    const submit = $("auth-submit");

    submit.disabled = true;
    submit.textContent = "لطفاً صبر کن...";

    try {
        if (authMode === "register") {
            const { data: result, error } =
                await modessaSupabase.auth.signUp({
                    email,
                    password
                });

            if (error) throw error;

            authMessage(
                result.session
                    ? "حساب کاربری ساخته شد."
                    : "ثبت‌نام انجام شد. ایمیلت را برای تأیید حساب بررسی کن.",
                "success"
            );

        } else {
            const { error } =
                await modessaSupabase.auth.signInWithPassword({
                    email,
                    password
                });

            if (error) throw error;

            authMessage("با موفقیت وارد شدی.", "success");
        }

    } catch (e) {
        authMessage(
            e.message || "مشکلی در ورود یا ثبت‌نام پیش آمد.",
            "error"
        );

    } finally {
        submit.disabled = false;

        submit.textContent =
            authMode === "login"
                ? "ورود به حساب"
                : "ساخت حساب کاربری";
    }
});

// ======================================
// LOGOUT
// ======================================

async function modessaLogout() {
    const { error } = await modessaSupabase.auth.signOut();

    if (error) {
        console.error(error);
        toast("خروج از حساب انجام نشد.");
    }
}

// ======================================
// EXPOSE HTML FUNCTIONS
// ======================================

window.modessaLogout = modessaLogout;
window.showPage = showPage;
window.changeMonth = changeMonth;
window.generateCode = generateCode;
window.copyCode = copyCode;
window.redeemCompanionCode = redeemCompanionCode;
window.saveSettings = saveSettings;
window.disconnectCompanion = disconnectCompanion;
window.sendCompanionMessage = sendCompanionMessage;

// ======================================
// RENDER ALL
// ======================================

function renderAll() {
    if (!currentUser || !data) return;

    renderToday();

    if (isCompanionUser()) {
        if ($("companion-dashboard")) {
            $("companion-dashboard").hidden = false;
            $("companion-dashboard").classList.add("active");
        }

        renderCompanionMessages();
        return;
    }

    if (!isOwnerUser()) return;

    renderDashboard();
    renderFullCalendar();
    renderRecords();
    renderSymptoms();
    renderProfile();
    renderCompanion();
}

// ======================================
// INITIALIZE SUPABASE AUTH
// ======================================

modessaSupabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => activateUser(session), 0);
});

changeAuthMode("login");
setAuthenticated(null);

(async () => {
    try {
        const { data: sessionData, error } =
            await modessaSupabase.auth.getSession();

        if (error) throw error;

        await activateUser(sessionData.session);

    } catch (e) {
        console.error("Auth initialization:", e);
        setAuthenticated(null);
        toast("ارتباط با سیستم ورود برقرار نشد.");
    }
})();

// ======================================
// DEBUG / CLOUD STATUS
// ======================================

window.modessaCloudStatus = async function () {
    const { data: result, error } =
        await modessaSupabase.auth.getUser();

    if (error || !result.user) {
        console.log("کاربر وارد نشده است.");
        return;
    }

    for (const table of [
        "period_logs",
        "symptom_logs"
    ]) {
        const { count, error: e } = await modessaSupabase
            .from(table)
            .select("*", { count: "exact", head: true })
            .eq("user_id", result.user.id);

        console.log(
            table,
            e ? e.message : `تعداد رکوردها: ${count}`
        );
    }
};