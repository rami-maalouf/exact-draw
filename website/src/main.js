// the page: entrances, the bar, the window that settles flat as you scroll, the lit statement,
// and the mac waitlist (/?join=mac opens it from a link).

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
requestAnimationFrame(() => document.body.classList.add("ready"));

const bar = document.querySelector(".bar");
const frost = () => bar?.classList.toggle("scrolled", scrollY > 8);
addEventListener("scroll", frost, { passive: true });
frost();

const seen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("seen");
      seen.unobserve(e.target);
    }
  },
  { rootMargin: "0px 0px -10% 0px" },
);
document.querySelectorAll(".observe").forEach((el) => seen.observe(el));

// scroll-driven pieces share one frame
const windowEl = document.querySelector("[data-tilt]");
const lit = document.querySelector("[data-lit]");
const spans = [];
if (lit) {
  const words = lit.textContent.trim().split(/\s+/);
  lit.textContent = "";
  words.forEach((word, i) => {
    const span = document.createElement("span");
    span.className = reduced ? "w on" : "w";
    span.textContent = word;
    lit.append(span, i < words.length - 1 ? " " : "");
    spans.push(span);
  });
}
const startTilt = parseFloat(getComputedStyle(windowEl ?? document.body).getPropertyValue("--tilt")) || 18;

let queued = false;
function paint() {
  queued = false;
  if (windowEl) {
    // flat once the window's middle reaches the middle of the screen
    const r = windowEl.getBoundingClientRect();
    const t = Math.min(Math.max((innerHeight - r.top) / (innerHeight * 0.75), 0), 1);
    windowEl.style.setProperty("--tilt", `${(startTilt * (1 - t)).toFixed(2)}deg`);
  }
  if (lit) {
    const r = lit.getBoundingClientRect();
    const start = innerHeight * 0.85;
    const end = innerHeight * 0.45;
    const t = (start - r.top) / (start - end + r.height);
    const count = Math.round(Math.min(Math.max(t, 0), 1) * spans.length);
    spans.forEach((s, i) => s.classList.toggle("on", i < count));
  }
}
if (!reduced) {
  const request = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(paint);
  };
  addEventListener("scroll", request, { passive: true });
  addEventListener("resize", request);
  paint();
}

// the mac waitlist
const dialog = document.getElementById("waitlist");
const emailInput = dialog?.querySelector("[data-email]");
const formPanel = dialog?.querySelector('[data-panel="form"]');
const donePanel = dialog?.querySelector('[data-panel="done"]');
const errorEl = dialog?.querySelector("[data-error]");
const submitBtn = dialog?.querySelector("[data-submit]");
let submitting = false;

function resetWaitlist() {
  formPanel.hidden = false;
  donePanel.hidden = true;
  errorEl.hidden = true;
  emailInput.value = "";
  submitting = false;
  submitBtn.disabled = false;
  submitBtn.textContent = "Join waitlist";
}

function openWaitlist() {
  resetWaitlist();
  dialog.showModal();
  queueMicrotask(() => emailInput.focus());
}

function fail(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
  submitting = false;
  submitBtn.disabled = false;
  submitBtn.textContent = "Join waitlist";
}

async function joinWaitlist() {
  if (submitting) return;
  const email = emailInput.value.trim();
  if (!email || !email.includes("@")) {
    fail("Please enter a valid email address.");
    emailInput.focus();
    return;
  }
  submitting = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Joining…";
  errorEl.hidden = true;
  try {
    // local preview: succeed without notion so the flow can be checked offline
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      await new Promise((r) => setTimeout(r, 450));
    } else {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, platform: "macOS" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to join waitlist");
    }
    formPanel.hidden = true;
    donePanel.hidden = false;
  } catch (error) {
    fail(error instanceof Error ? error.message : "Something went wrong");
  }
}

if (dialog) {
  document.querySelectorAll("[data-waitlist-open]").forEach((btn) => btn.addEventListener("click", openWaitlist));
  dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());
  submitBtn.addEventListener("click", (e) => {
    e.preventDefault();
    joinWaitlist();
  });
  emailInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    joinWaitlist();
  });
  if (new URLSearchParams(location.search).has("join")) openWaitlist();
}
