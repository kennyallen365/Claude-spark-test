/**
 * Meal Planner App
 *
 * Data model (localStorage key: "mealPlanner"):
 * {
 *   meals: [{ id, name, dates: [ISO-date, ...] }],
 *   weeklyPlans: [{
 *     weekStart: ISO-date,          // Sunday
 *     mealIds: [id, ...],
 *     checked: { id: bool },
 *     grocerySnapshot: [{ name, section, checked }] | null
 *   }],
 *   groceryList: { items: [{ id, name, section, checked }] },
 *   groceryKnown: [{ name, section }]   // autocomplete history
 * }
 */

// ── Utilities ─────────────────────────────────────────────────────────────────

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function toLocalISO(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dy}`;
}

/** Return the Sunday (local ISO date) of the week containing `isoDate`. */
function weekStart(isoDate) {
  const d = new Date(isoDate + "T12:00:00"); // noon avoids DST edge cases
  d.setDate(d.getDate() - d.getDay());        // getDay() 0=Sun → subtract to land on Sunday
  return toLocalISO(d);
}

/** Add n weeks to an ISO date string. */
function addWeeks(isoDate, n) {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + n * 7);
  return toLocalISO(d);
}

/** Format a week-start ISO date as "Sun, Feb 22, 2026". */
function formatWeek(isoDate) {
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** Format a week as a date range "Mar 16 – Mar 22, 2026". */
function formatWeekRange(isoDate) {
  const start = new Date(isoDate + "T12:00:00");
  const end   = new Date(isoDate + "T12:00:00");
  end.setDate(end.getDate() + 6);
  const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr   = end.toLocaleDateString("en-US",   { month: "short", day: "numeric", year: "numeric" });
  return `${startStr} – ${endStr}`;
}

/** Absolute days between two ISO date strings. */
function daysBetween(a, b) {
  return Math.round(Math.abs(new Date(a + "T12:00:00") - new Date(b + "T12:00:00")) / 86400000);
}

function today() {
  return toLocalISO(new Date());
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "mealPlanner";

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.meals)        parsed.meals        = [];
      if (!parsed.weeklyPlans)  parsed.weeklyPlans  = [];
      if (!parsed.groceryList)  parsed.groceryList  = { items: [] };
      if (!parsed.groceryKnown) parsed.groceryKnown = [];
      // Migrate: ensure all plans have grocerySnapshot field
      parsed.weeklyPlans.forEach(p => {
        if (!("grocerySnapshot" in p)) p.grocerySnapshot = null;
      });
      // Migrate: ensure all meals have ingredients field
      parsed.meals.forEach(m => {
        if (!m.ingredients) m.ingredients = [];
      });
      return parsed;
    }
  } catch (err) {
    console.error("loadData failed:", err);
  }
  return { meals: [], weeklyPlans: [], groceryList: { items: [] }, groceryKnown: [] };
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ── App state ─────────────────────────────────────────────────────────────────

let data = loadData();
let thisWeekDate  = weekStart(today()); // week being viewed/edited in This Week tab
let historyDate   = weekStart(today()); // week being viewed in History tab
let overdueThreshold = 3;              // weeks

// Init historyDate to the most recent week with any plan data
{
  const dates = data.weeklyPlans.map(p => p.weekStart).sort();
  if (dates.length) historyDate = dates[dates.length - 1];
}

// ── Meal helpers ──────────────────────────────────────────────────────────────

function getMealById(id) {
  return data.meals.find(m => m.id === id);
}

function getOrCreateMeal(name) {
  const norm = name.trim().toLowerCase();
  let meal = data.meals.find(m => m.name.toLowerCase() === norm);
  if (!meal) {
    meal = { id: uuid(), name: name.trim(), dates: [], ingredients: [] };
    data.meals.push(meal);
  }
  if (!meal.ingredients) meal.ingredients = [];
  return meal;
}

function lastMadeDate(meal) {
  if (!meal.dates || meal.dates.length === 0) return null;
  return meal.dates.slice().sort().reverse()[0];
}

function daysSinceLastMade(meal) {
  const last = lastMadeDate(meal);
  return last ? daysBetween(last, today()) : null;
}

// ── Weekly plan helpers ───────────────────────────────────────────────────────

/** Get (or lazily create) the plan object for a given week-start date. */
function getWeekPlan(dateStr) {
  let plan = data.weeklyPlans.find(p => p.weekStart === dateStr);
  if (!plan) {
    plan = { weekStart: dateStr, mealIds: [], checked: {}, grocerySnapshot: null };
    data.weeklyPlans.push(plan);
  }
  return plan;
}

// ── Grocery section definitions (needed by both Grocery tab and History tab) ──

const GROCERY_SECTIONS = [
  { key: "mealingredients", label: "Meal Ingredients", icon: "🍽️", css: "section-mealingredients" },
  { key: "produce", label: "Fruit & Produce", icon: "🥦", css: "section-produce" },
  { key: "bakery",  label: "Bakery",          icon: "🍞", css: "section-bakery"  },
  { key: "snacks",  label: "Snacks",          icon: "🍿", css: "section-snacks"  },
  { key: "drinks",  label: "Drinks",          icon: "🧃", css: "section-drinks"  },
  { key: "pantry",  label: "Pantry",          icon: "🥫", css: "section-pantry"  },
  { key: "meats",   label: "Meats",           icon: "🥩", css: "section-meats"   },
  { key: "frozen",  label: "Frozen & Dairy",  icon: "🧊", css: "section-frozen"  },
  { key: "misc",    label: "Misc",            icon: "🛒", css: "section-misc"    },
];

function sectionLabelToKey(label) {
  const s = GROCERY_SECTIONS.find(s => s.label === label);
  return s ? s.key : "misc";
}

function sectionKeyToLabel(key) {
  const s = GROCERY_SECTIONS.find(s => s.key === key);
  return s ? s.label : "Misc";
}

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "history") renderHistory();
    if (tab.dataset.tab === "overdue")  renderOverdue();
    if (tab.dataset.tab === "grocery")  renderGrocery();
  });
});

// ── THIS WEEK tab ─────────────────────────────────────────────────────────────

function renderThisWeek() {
  const currentWeek = weekStart(today());
  const prevBtn = document.getElementById("this-week-prev-btn");
  const nextBtn = document.getElementById("this-week-next-btn");

  prevBtn.disabled = false;
  nextBtn.disabled = thisWeekDate >= currentWeek;

  const isCurrent = thisWeekDate === currentWeek;
  document.getElementById("week-label").textContent =
    "Week of " + formatWeek(thisWeekDate) + (isCurrent ? "" : " ↩");

  const plan = getWeekPlan(thisWeekDate);
  const list = document.getElementById("this-week-list");
  const emptyMsg = document.getElementById("this-week-empty");
  list.innerHTML = "";

  emptyMsg.style.display = plan.mealIds.length === 0 ? "block" : "none";

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
    lastMadeTxt.textContent = days === null ? "never" : days === 0 ? "today" : days + "d ago";

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

document.getElementById("this-week-prev-btn").addEventListener("click", () => {
  try {
    thisWeekDate = addWeeks(thisWeekDate, -1);
    renderThisWeek();
  } catch (err) { console.error("this-week-prev:", err); }
});
document.getElementById("this-week-next-btn").addEventListener("click", () => {
  try {
    thisWeekDate = addWeeks(thisWeekDate, 1);
    renderThisWeek();
  } catch (err) { console.error("this-week-next:", err); }
});

// -- Add meal input & autocomplete --

const mealInput    = document.getElementById("meal-input");
const suggestionsEl = document.getElementById("meal-suggestions");

mealInput.addEventListener("input", () => {
  const q = mealInput.value.trim().toLowerCase();
  suggestionsEl.innerHTML = "";
  if (q.length < 1) return;

  const plan = getWeekPlan(thisWeekDate);
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
  if (e.key === "Enter")  { suggestionsEl.innerHTML = ""; addMealToWeek(mealInput.value); }
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
  const plan = getWeekPlan(thisWeekDate);
  if (!plan.mealIds.includes(meal.id)) {
    plan.mealIds.push(meal.id);
    saveData(data);
  }
  mealInput.value = "";
  renderThisWeek();

  // Prompt to add ingredients to grocery list
  openModal(
    `Add ingredients for "${meal.name}" to grocery list?`,
    () => {
      const raw = document.getElementById("modal-input").value;
      const ingredients = raw.split(",").map(s => s.trim()).filter(Boolean);
      if (ingredients.length > 0) {
        meal.ingredients = ingredients;
        ingredients.forEach(ing => {
          const norm = ing.toLowerCase();
          if (!data.groceryList.items.some(i => i.name.toLowerCase() === norm)) {
            data.groceryList.items.push({ id: uuid(), name: ing, section: "mealingredients", checked: false });
          }
        });
        saveData(data);
      }
    },
    {
      inputPlaceholder: "e.g. chicken, bell pepper, soy sauce",
      inputValue: meal.ingredients.join(", "),
      confirmLabel: "Add to Grocery",
      cancelLabel: "Skip",
    }
  );
}

document.getElementById("clear-week-btn").addEventListener("click", () => {
  const plan = getWeekPlan(thisWeekDate);
  if (plan.mealIds.length === 0) return;
  openModal("Clear all meals from this week's tracker?", () => {
    plan.mealIds = [];
    plan.checked = {};
    saveData(data);
    renderThisWeek();
  });
});

document.getElementById("save-week-btn").addEventListener("click", () => {
  const plan = getWeekPlan(thisWeekDate);
  if (plan.mealIds.length === 0) { alert("Add some meals before archiving!"); return; }
  openModal(
    `Archive week of ${formatWeek(thisWeekDate)} to history? Records today's date for all checked meals.`,
    () => {
      const dateStr = today();
      plan.mealIds.forEach(id => {
        if (plan.checked[id]) {
          const meal = getMealById(id);
          if (meal && !meal.dates.includes(dateStr)) meal.dates.push(dateStr);
        }
      });
      saveData(data);
      renderThisWeek();
      renderOverdue();
      showToast("Week archived to history!");
    }
  );
});

// ── HISTORY tab ───────────────────────────────────────────────────────────────

function renderHistory() {
  const currentWeek = weekStart(today());
  const prevBtn = document.getElementById("prev-week-btn");
  const nextBtn = document.getElementById("next-week-btn");

  prevBtn.disabled = false;
  nextBtn.disabled = historyDate >= currentWeek;

  document.getElementById("history-week-label").textContent = formatWeekRange(historyDate);

  const plan = data.weeklyPlans.find(p => p.weekStart === historyDate) || null;
  const view = document.getElementById("history-view-select").value;

  if (view === "meals") {
    renderHistoryMeals(plan);
  } else {
    renderHistoryGrocery(plan);
  }
}

function renderHistoryMeals(plan) {
  const list    = document.getElementById("history-list");
  const emptyMsg = document.getElementById("history-empty");
  const actions  = document.getElementById("history-actions");

  list.innerHTML = "";

  if (!plan || plan.mealIds.length === 0) {
    emptyMsg.style.display = "block";
    emptyMsg.textContent   = "No meals logged for this week.";
    actions.style.display  = "none";
    return;
  }

  emptyMsg.style.display = "none";
  actions.style.display  = "flex";

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

function renderHistoryGrocery(plan) {
  const list    = document.getElementById("history-list");
  const emptyMsg = document.getElementById("history-empty");
  const actions  = document.getElementById("history-actions");

  list.innerHTML = "";
  actions.style.display = "none";

  if (!plan || !plan.grocerySnapshot || plan.grocerySnapshot.length === 0) {
    emptyMsg.style.display = "block";
    emptyMsg.textContent   = "No grocery list saved for this week.";
    return;
  }

  emptyMsg.style.display = "none";

  let firstSection = true;
  GROCERY_SECTIONS.forEach(sec => {
    const items = plan.grocerySnapshot.filter(i => i.section === sec.key);
    if (items.length === 0) return;

    const hdr = document.createElement("li");
    hdr.className = `grocery-section-header ${sec.css} history-list-section-hdr` +
                    (firstSection ? " first" : "");
    hdr.innerHTML = `<span class="grocery-section-icon">${sec.icon}</span>
                     <span class="grocery-section-name">${sec.label}</span>`;
    list.appendChild(hdr);
    firstSection = false;

    items.forEach(item => {
      const li = document.createElement("li");
      li.className = "meal-item" + (item.checked ? " done" : "");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = item.checked;
      cb.disabled = true;

      const name = document.createElement("span");
      name.className = "meal-name";
      name.textContent = item.name;

      li.append(cb, name);
      list.appendChild(li);
    });
  });
}

document.getElementById("prev-week-btn").addEventListener("click", () => {
  try {
    historyDate = addWeeks(historyDate, -1);
    renderHistory();
  } catch (err) { console.error("history-prev:", err); }
});
document.getElementById("next-week-btn").addEventListener("click", () => {
  try {
    historyDate = addWeeks(historyDate, 1);
    renderHistory();
  } catch (err) { console.error("history-next:", err); }
});

document.getElementById("history-view-select").addEventListener("change", () => {
  renderHistory();
});

document.getElementById("delete-week-btn").addEventListener("click", () => {
  const plan = data.weeklyPlans.find(p => p.weekStart === historyDate);
  if (!plan) return;
  openModal(`Delete the entry for week of ${formatWeek(historyDate)}? This cannot be undone.`, () => {
    // Remove meal dates that fall within this week's window
    const ws = new Date(historyDate + "T00:00:00");
    const we = new Date(ws);
    we.setDate(we.getDate() + 7);
    data.meals.forEach(meal => {
      meal.dates = meal.dates.filter(d => {
        const dt = new Date(d + "T00:00:00");
        return dt < ws || dt >= we;
      });
    });
    data.weeklyPlans = data.weeklyPlans.filter(p => p.weekStart !== historyDate);
    saveData(data);
    renderHistory();
  });
});

// ── OVERDUE / RECENCY tab ─────────────────────────────────────────────────────

function renderOverdue() {
  const list     = document.getElementById("overdue-list");
  const emptyMsg = document.getElementById("overdue-empty");
  const thresholdDays = overdueThreshold * 7;

  const overdue = data.meals
    .map(meal => ({ meal, days: daysSinceLastMade(meal) }))
    .filter(({ days }) => days === null || days >= thresholdDays)
    .sort((a, b) => {
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

      const addBtn = document.createElement("button");
      addBtn.className = "btn-secondary";
      addBtn.style.fontSize = ".78rem";
      addBtn.style.padding  = ".3rem .6rem";
      addBtn.textContent    = "+ This Week";
      addBtn.addEventListener("click", () => {
        const plan = getWeekPlan(thisWeekDate);
        if (!plan.mealIds.includes(meal.id)) {
          plan.mealIds.push(meal.id);
          saveData(data);
          renderThisWeek();
        }
        document.querySelector("[data-tab='this-week']").click();
      });

      li.append(name, badge, addBtn);
      list.appendChild(li);
    });
  }
}

document.getElementById("threshold-input").addEventListener("change", e => {
  const val = parseInt(e.target.value, 10);
  if (!isNaN(val) && val > 0) { overdueThreshold = val; renderOverdue(); }
});

// ── GROCERY tab ───────────────────────────────────────────────────────────────

function renderGrocery() {
  const items     = data.groceryList.items;
  const container = document.getElementById("grocery-sections");
  const emptyMsg  = document.getElementById("grocery-empty");
  container.innerHTML = "";

  if (items.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }
  emptyMsg.style.display = "none";

  GROCERY_SECTIONS.forEach(sec => {
    const sectionItems = items.filter(i => i.section === sec.key);
    if (sectionItems.length === 0) return;

    const unchecked = sectionItems.filter(i => !i.checked);
    const checked   = sectionItems.filter(i =>  i.checked);
    const ordered   = [...unchecked, ...checked];

    const wrapper = document.createElement("div");
    wrapper.className = "grocery-section";

    const header = document.createElement("div");
    header.className = `grocery-section-header ${sec.css}`;
    header.innerHTML = `
      <span class="grocery-section-icon">${sec.icon}</span>
      <span class="grocery-section-name">${sec.label}</span>
      <span class="grocery-section-count">${unchecked.length}/${sectionItems.length}</span>
    `;
    wrapper.appendChild(header);

    ordered.forEach(item => {
      const row = document.createElement("div");
      row.className = "grocery-item" + (item.checked ? " done" : "");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = item.checked;
      cb.addEventListener("change", () => {
        item.checked = cb.checked;
        saveData(data);
        renderGrocery();
      });

      const name = document.createElement("span");
      name.className = "grocery-item-name";
      name.textContent = item.name;

      const del = document.createElement("button");
      del.className = "meal-delete";
      del.title = "Remove item";
      del.textContent = "×";
      del.addEventListener("click", () => {
        data.groceryList.items = data.groceryList.items.filter(i => i.id !== item.id);
        saveData(data);
        renderGrocery();
      });

      row.append(cb, name, del);
      wrapper.appendChild(row);
    });

    container.appendChild(wrapper);
  });
}

// -- Grocery autocomplete --

const groceryInput     = document.getElementById("grocery-input");
const grocerySuggest   = document.getElementById("grocery-suggestions");
const grocerySectionSel = document.getElementById("grocery-section-select");

groceryInput.addEventListener("input", () => {
  const q = groceryInput.value.trim().toLowerCase();
  grocerySuggest.innerHTML = "";
  if (q.length < 1) return;

  const already = new Set(data.groceryList.items.map(i => i.name.toLowerCase()));
  const matches = data.groceryKnown
    .filter(k => k.name.toLowerCase().includes(q) && !already.has(k.name.toLowerCase()))
    .slice(0, 7);

  matches.forEach(k => {
    const div = document.createElement("div");
    div.className = "suggestion-item";
    div.innerHTML = `${k.name} <small style="color:var(--gray-400)">${sectionKeyToLabel(k.section)}</small>`;
    div.addEventListener("mousedown", e => {
      e.preventDefault();
      groceryInput.value = k.name;
      const label = sectionKeyToLabel(k.section);
      Array.from(grocerySectionSel.options).forEach(opt => { opt.selected = opt.value === label; });
      grocerySuggest.innerHTML = "";
      addGroceryItem();
    });
    grocerySuggest.appendChild(div);
  });
});

groceryInput.addEventListener("keydown", e => {
  if (e.key === "Enter")  { grocerySuggest.innerHTML = ""; addGroceryItem(); }
  if (e.key === "Escape") grocerySuggest.innerHTML = "";
});

document.addEventListener("click", e => {
  if (!e.target.closest("#grocery-input") && !e.target.closest("#grocery-suggestions")) {
    grocerySuggest.innerHTML = "";
  }
});

document.getElementById("add-grocery-btn").addEventListener("click", () => {
  grocerySuggest.innerHTML = "";
  addGroceryItem();
});

function addGroceryItem() {
  const name = groceryInput.value.trim();
  if (!name) { groceryInput.focus(); return; }

  const sectionLabel = grocerySectionSel.value;
  if (!sectionLabel) {
    grocerySectionSel.focus();
    grocerySectionSel.style.borderColor = "var(--red)";
    setTimeout(() => { grocerySectionSel.style.borderColor = ""; }, 1200);
    return;
  }

  const sectionKey = sectionLabelToKey(sectionLabel);
  const norm = name.toLowerCase();

  if (data.groceryList.items.some(i => i.name.toLowerCase() === norm)) {
    groceryInput.value = "";
    groceryInput.focus();
    return;
  }

  data.groceryList.items.push({ id: uuid(), name, section: sectionKey, checked: false });

  // Upsert into known-items for future autocomplete
  const existing = data.groceryKnown.find(k => k.name.toLowerCase() === norm);
  if (existing) {
    existing.section = sectionKey;
  } else {
    data.groceryKnown.push({ name, section: sectionKey });
  }

  saveData(data);
  groceryInput.value = "";
  groceryInput.focus();
  renderGrocery();
}

// -- Clear checked --

document.getElementById("clear-checked-btn").addEventListener("click", () => {
  const checked = data.groceryList.items.filter(i => i.checked);
  if (checked.length === 0) return;
  openModal(
    `Remove ${checked.length} checked item${checked.length > 1 ? "s" : ""} from the list?`,
    () => {
      data.groceryList.items = data.groceryList.items.filter(i => !i.checked);
      saveData(data);
      renderGrocery();
    }
  );
});

// -- Done: snapshot grocery list into this week's history --

document.getElementById("grocery-done-btn").addEventListener("click", () => {
  const items = data.groceryList.items;
  if (items.length === 0) return;
  const currentWeek = weekStart(today());
  openModal(
    `Save this grocery list to the week of ${formatWeek(currentWeek)} and clear the active list?`,
    () => {
      const plan = getWeekPlan(currentWeek);
      plan.grocerySnapshot = items.map(i => ({
        name: i.name,
        section: i.section,
        checked: i.checked,
      }));
      data.groceryList.items = [];
      saveData(data);
      renderGrocery();
    }
  );
});

// -- New list --

document.getElementById("new-list-btn").addEventListener("click", () => {
  if (data.groceryList.items.length === 0) return;
  openModal("Start a new grocery list? This will clear all current items.", () => {
    data.groceryList.items = [];
    saveData(data);
    renderGrocery();
  });
});

// ── Modal ─────────────────────────────────────────────────────────────────────

let modalCallback = null;
let modalCancelCallback = null;

/**
 * @param {string} message
 * @param {Function} onConfirm
 * @param {{ inputPlaceholder?: string, inputValue?: string,
 *           confirmLabel?: string, cancelLabel?: string,
 *           onCancel?: Function }} [opts]
 */
function openModal(message, onConfirm, opts = {}) {
  document.getElementById("modal-message").textContent = message;

  const inputWrap = document.getElementById("modal-input-wrap");
  const input     = document.getElementById("modal-input");
  if (opts.inputPlaceholder !== undefined) {
    inputWrap.style.display = "block";
    input.placeholder = opts.inputPlaceholder || "";
    input.value       = opts.inputValue       || "";
    setTimeout(() => input.focus(), 60);
  } else {
    inputWrap.style.display = "none";
    input.value = "";
  }

  document.getElementById("modal-confirm").textContent = opts.confirmLabel || "Confirm";
  document.getElementById("modal-cancel").textContent  = opts.cancelLabel  || "Cancel";

  document.getElementById("modal-overlay").style.display = "flex";
  modalCallback       = onConfirm;
  modalCancelCallback = opts.onCancel || null;
}

function closeModal() {
  document.getElementById("modal-overlay").style.display = "none";
  document.getElementById("modal-confirm").textContent = "Confirm";
  document.getElementById("modal-cancel").textContent  = "Cancel";
  document.getElementById("modal-input-wrap").style.display = "none";
  document.getElementById("modal-input").value = "";
  modalCallback       = null;
  modalCancelCallback = null;
}

document.getElementById("modal-confirm").addEventListener("click", () => {
  if (modalCallback) modalCallback();
  closeModal();
});
document.getElementById("modal-cancel").addEventListener("click", () => {
  if (modalCancelCallback) modalCancelCallback();
  closeModal();
});
document.getElementById("modal-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
});

// ── Toast ──────────────────────────────────────────────────────────────────────

let _toastTimer = null;
function showToast(msg, duration = 2500) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), duration);
}

// ── Init ──────────────────────────────────────────────────────────────────────

console.log("[MealPlanner v4] loaded. thisWeekDate =", thisWeekDate);
renderThisWeek();
