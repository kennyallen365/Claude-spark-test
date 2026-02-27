/**
 * Meal Planner App
 *
 * Data model (localStorage key: "mealPlanner"):
 * {
 *   meals: [{ id, name, dates: [ISO-date, ...] }],
 *   weeklyPlans: [{ weekStart: ISO-date, mealIds: [id, ...], checked: { id: bool } }]
 * }
 */

// ── Utilities ─────────────────────────────────────────────────────────────────

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Return Monday (ISO date string) of the week containing `date`. */
function weekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Format a week-start date as "Mon Feb 24, 2026". */
function formatWeek(isoDate) {
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** Days between two ISO date strings (absolute). */
function daysBetween(a, b) {
  const msPerDay = 86400000;
  return Math.round(Math.abs(new Date(a) - new Date(b)) / msPerDay);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "mealPlanner";

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { meals: [], weeklyPlans: [] };
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ── App state ─────────────────────────────────────────────────────────────────

let data = loadData();
let currentHistoryIndex = 0; // index into sorted weeklyPlans array (0 = most recent)
let overdueThreshold = 3;    // weeks

// ── Meal helpers ──────────────────────────────────────────────────────────────

function getMealById(id) {
  return data.meals.find(m => m.id === id);
}

function getOrCreateMeal(name) {
  const norm = name.trim().toLowerCase();
  let meal = data.meals.find(m => m.name.toLowerCase() === norm);
  if (!meal) {
    meal = { id: uuid(), name: name.trim(), dates: [] };
    data.meals.push(meal);
  }
  return meal;
}

/** Most recent date this meal was recorded (from weeklyPlans that are saved). */
function lastMadeDate(meal) {
  if (!meal.dates || meal.dates.length === 0) return null;
  return meal.dates.slice().sort().reverse()[0];
}

/** How many days ago was this meal last made? */
function daysSinceLastMade(meal) {
  const last = lastMadeDate(meal);
  if (!last) return null;
  return daysBetween(last, today());
}

// ── Weekly plan helpers ───────────────────────────────────────────────────────

function getThisWeekPlan() {
  const ws = weekStart(today());
  let plan = data.weeklyPlans.find(p => p.weekStart === ws);
  if (!plan) {
    plan = { weekStart: ws, mealIds: [], checked: {} };
    data.weeklyPlans.push(plan);
  }
  return plan;
}

/** Sorted weekly plans, newest first */
function sortedPlans() {
  return data.weeklyPlans.slice().sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
}

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "history") renderHistory();
    if (tab.dataset.tab === "overdue") renderOverdue();
  });
});

// ── THIS WEEK tab ─────────────────────────────────────────────────────────────

function renderThisWeek() {
  const plan = getThisWeekPlan();
  document.getElementById("week-label").textContent = "Week of " + formatWeek(plan.weekStart);

  const list = document.getElementById("this-week-list");
  list.innerHTML = "";

  plan.mealIds.forEach(id => {
    const meal = getMealById(id);
    if (!meal) return;
    const checked = !!plan.checked[id];

    const li = document.createElement("li");
    li.className = "meal-item" + (checked ? " done" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    cb.addEventListener("change", () => {
      plan.checked[id] = cb.checked;
      li.classList.toggle("done", cb.checked);
      saveData(data);
    });

    const name = document.createElement("span");
    name.className = "meal-name";
    name.textContent = meal.name;

    const days = daysSinceLastMade(meal);
    const lastMadeTxt = document.createElement("span");
    lastMadeTxt.className = "last-made";
    if (days === null) {
      lastMadeTxt.textContent = "never";
    } else {
      lastMadeTxt.textContent = days === 0 ? "today" : days + "d ago";
    }

    const del = document.createElement("button");
    del.className = "meal-delete";
    del.title = "Remove from this week";
    del.textContent = "×";
    del.addEventListener("click", () => {
      plan.mealIds = plan.mealIds.filter(x => x !== id);
      delete plan.checked[id];
      saveData(data);
      renderThisWeek();
    });

    li.append(cb, name, lastMadeTxt, del);
    list.appendChild(li);
  });
}

// -- Add meal input & autocomplete --

const mealInput = document.getElementById("meal-input");
const suggestionsEl = document.getElementById("meal-suggestions");

mealInput.addEventListener("input", () => {
  const q = mealInput.value.trim().toLowerCase();
  suggestionsEl.innerHTML = "";
  if (q.length < 1) return;

  const plan = getThisWeekPlan();
  const matches = data.meals.filter(m =>
    m.name.toLowerCase().includes(q) &&
    !plan.mealIds.includes(m.id)
  ).slice(0, 6);

  matches.forEach(m => {
    const div = document.createElement("div");
    div.className = "suggestion-item";
    div.textContent = m.name;
    div.addEventListener("mousedown", e => {
      e.preventDefault();
      mealInput.value = m.name;
      suggestionsEl.innerHTML = "";
      addMealToWeek(m.name);
    });
    suggestionsEl.appendChild(div);
  });
});

mealInput.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    suggestionsEl.innerHTML = "";
    addMealToWeek(mealInput.value);
  }
  if (e.key === "Escape") suggestionsEl.innerHTML = "";
});

document.addEventListener("click", e => {
  if (!e.target.closest(".add-meal-row")) suggestionsEl.innerHTML = "";
});

document.getElementById("add-meal-btn").addEventListener("click", () => {
  suggestionsEl.innerHTML = "";
  addMealToWeek(mealInput.value);
});

function addMealToWeek(rawName) {
  const name = rawName.trim();
  if (!name) return;
  const meal = getOrCreateMeal(name);
  const plan = getThisWeekPlan();
  if (!plan.mealIds.includes(meal.id)) {
    plan.mealIds.push(meal.id);
    saveData(data);
  }
  mealInput.value = "";
  renderThisWeek();
}

// -- Clear week --

document.getElementById("clear-week-btn").addEventListener("click", () => {
  const plan = getThisWeekPlan();
  if (plan.mealIds.length === 0) return;
  openModal(
    "Clear all meals from this week's tracker?",
    () => {
      plan.mealIds = [];
      plan.checked = {};
      saveData(data);
      renderThisWeek();
    }
  );
});

// -- Save week to history --

document.getElementById("save-week-btn").addEventListener("click", () => {
  const plan = getThisWeekPlan();
  if (plan.mealIds.length === 0) {
    alert("Add some meals before saving!");
    return;
  }
  openModal(
    `Save this week (${formatWeek(plan.weekStart)}) to history? This records today's date for all checked meals.`,
    () => {
      const dateStr = today();
      plan.mealIds.forEach(id => {
        if (plan.checked[id]) {
          const meal = getMealById(id);
          if (meal && !meal.dates.includes(dateStr)) {
            meal.dates.push(dateStr);
          }
        }
      });
      saveData(data);
      renderThisWeek();
      renderOverdue();
    }
  );
});

// ── HISTORY tab ───────────────────────────────────────────────────────────────

function renderHistory() {
  const plans = sortedPlans();

  // Only show weeks that have been saved (i.e. have at least one meal that has a date recorded in that week range)
  // We show all weeklyPlans entries that have mealIds (they were created when user added meals).
  // Sort newest first; let the user navigate back through them.

  const prevBtn = document.getElementById("prev-week-btn");
  const nextBtn = document.getElementById("next-week-btn");
  const label = document.getElementById("history-week-label");
  const list = document.getElementById("history-list");
  const emptyMsg = document.getElementById("history-empty");
  const actions = document.getElementById("history-actions");

  if (plans.length === 0) {
    label.textContent = "No history yet";
    list.innerHTML = "";
    emptyMsg.style.display = "block";
    actions.style.display = "none";
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  if (currentHistoryIndex >= plans.length) currentHistoryIndex = plans.length - 1;
  if (currentHistoryIndex < 0) currentHistoryIndex = 0;

  const plan = plans[currentHistoryIndex];
  label.textContent = "Week of " + formatWeek(plan.weekStart);
  prevBtn.disabled = currentHistoryIndex >= plans.length - 1;
  nextBtn.disabled = currentHistoryIndex <= 0;

  list.innerHTML = "";
  if (plan.mealIds.length === 0) {
    emptyMsg.style.display = "block";
    actions.style.display = "none";
  } else {
    emptyMsg.style.display = "none";
    actions.style.display = "flex";

    plan.mealIds.forEach(id => {
      const meal = getMealById(id);
      if (!meal) return;
      const checked = !!plan.checked[id];

      const li = document.createElement("li");
      li.className = "meal-item" + (checked ? " done" : "");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked;
      cb.disabled = true;

      const name = document.createElement("span");
      name.className = "meal-name";
      name.textContent = meal.name;

      const badge = document.createElement("span");
      badge.className = "meal-badge " + (checked ? "badge-ok" : "badge-never");
      badge.textContent = checked ? "prepped" : "skipped";

      li.append(cb, name, badge);
      list.appendChild(li);
    });
  }
}

document.getElementById("prev-week-btn").addEventListener("click", () => {
  currentHistoryIndex++;
  renderHistory();
});
document.getElementById("next-week-btn").addEventListener("click", () => {
  currentHistoryIndex--;
  renderHistory();
});

document.getElementById("delete-week-btn").addEventListener("click", () => {
  const plans = sortedPlans();
  const plan = plans[currentHistoryIndex];
  openModal(
    `Delete the entry for week of ${formatWeek(plan.weekStart)}? This cannot be undone.`,
    () => {
      // Remove recorded dates from meals for that week (dates within that 7-day window)
      const ws = new Date(plan.weekStart + "T00:00:00");
      const we = new Date(ws);
      we.setDate(we.getDate() + 7);

      data.meals.forEach(meal => {
        meal.dates = meal.dates.filter(d => {
          const dt = new Date(d + "T00:00:00");
          return dt < ws || dt >= we;
        });
      });

      data.weeklyPlans = data.weeklyPlans.filter(p => p.weekStart !== plan.weekStart);
      saveData(data);
      if (currentHistoryIndex >= data.weeklyPlans.length) currentHistoryIndex--;
      if (currentHistoryIndex < 0) currentHistoryIndex = 0;
      renderHistory();
    }
  );
});

// ── OVERDUE / RECENCY tab ─────────────────────────────────────────────────────

function renderOverdue() {
  const list = document.getElementById("overdue-list");
  const emptyMsg = document.getElementById("overdue-empty");
  const thresholdDays = overdueThreshold * 7;

  const overdue = data.meals
    .map(meal => {
      const days = daysSinceLastMade(meal);
      return { meal, days };
    })
    .filter(({ meal, days }) => {
      // Include if never made, or made more than threshold weeks ago
      if (days === null) return true;
      return days >= thresholdDays;
    })
    .sort((a, b) => {
      // Never made sorts to the end; otherwise oldest first
      if (a.days === null && b.days === null) return a.meal.name.localeCompare(b.meal.name);
      if (a.days === null) return 1;
      if (b.days === null) return -1;
      return b.days - a.days;
    });

  list.innerHTML = "";

  if (overdue.length === 0) {
    emptyMsg.style.display = "block";
  } else {
    emptyMsg.style.display = "none";
    overdue.forEach(({ meal, days }) => {
      const li = document.createElement("li");
      li.className = "meal-item";

      const name = document.createElement("span");
      name.className = "meal-name";
      name.textContent = meal.name;

      const badge = document.createElement("span");
      if (days === null) {
        badge.className = "meal-badge badge-never";
        badge.textContent = "never made";
      } else {
        badge.className = "meal-badge badge-overdue";
        const weeksAgo = Math.floor(days / 7);
        badge.textContent = weeksAgo === 0 ? `${days}d ago` : `${weeksAgo}w ago`;
      }

      // Quick-add button to add this meal to the current week
      const addBtn = document.createElement("button");
      addBtn.className = "btn-secondary";
      addBtn.style.fontSize = ".78rem";
      addBtn.style.padding = ".3rem .6rem";
      addBtn.textContent = "+ This Week";
      addBtn.addEventListener("click", () => {
        const plan = getThisWeekPlan();
        if (!plan.mealIds.includes(meal.id)) {
          plan.mealIds.push(meal.id);
          saveData(data);
          renderThisWeek();
        }
        // Switch to this-week tab
        document.querySelector("[data-tab='this-week']").click();
      });

      li.append(name, badge, addBtn);
      list.appendChild(li);
    });
  }
}

document.getElementById("threshold-input").addEventListener("change", e => {
  const val = parseInt(e.target.value, 10);
  if (!isNaN(val) && val > 0) {
    overdueThreshold = val;
    renderOverdue();
  }
});

// ── Modal ─────────────────────────────────────────────────────────────────────

let modalCallback = null;

function openModal(message, onConfirm) {
  document.getElementById("modal-message").textContent = message;
  document.getElementById("modal-overlay").style.display = "flex";
  modalCallback = onConfirm;
}

function closeModal() {
  document.getElementById("modal-overlay").style.display = "none";
  modalCallback = null;
}

document.getElementById("modal-confirm").addEventListener("click", () => {
  if (modalCallback) modalCallback();
  closeModal();
});
document.getElementById("modal-cancel").addEventListener("click", closeModal);
document.getElementById("modal-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
});

// ── Init ──────────────────────────────────────────────────────────────────────

renderThisWeek();
