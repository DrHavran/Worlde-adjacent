// ---------- data loading ----------

async function getData(file) {
    const isProduction = window.location.hostname === "drhavran.github.io";
    const url = isProduction
        ? `https://drhavran.github.io/Worlde-adjacent/${file}`
        : `../${file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    return response.json();
}

// ---------- "done" state (per-URL, per-browser) ----------

const STORAGE_PREFIX = "game-done:";

function isDone(url) {
    return localStorage.getItem(STORAGE_PREFIX + url) === "true";
}

function setDone(url, done) {
    if (done) localStorage.setItem(STORAGE_PREFIX + url, "true");
    else localStorage.removeItem(STORAGE_PREFIX + url);
}

// ---------- one game card ----------

function createCard(name, entry) {
    // entry is either a plain URL string, or { url, thumb }
    const url   = typeof entry === "string" ? entry : entry.url;
    const thumb = typeof entry === "string" ? ""    : (entry.thumb || "");

    const li = document.createElement("li");
    li.className = "game-card";

    // invisible overlay link — makes the whole card clickable
    const link = document.createElement("a");
    link.className = "card-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", name);

    // thumbnail (or placeholder if missing / broken)
    const thumbWrap = document.createElement("div");
    thumbWrap.className = "thumb-wrap";

    const makePlaceholder = () => {
        const ph = document.createElement("div");
        ph.className = "thumb placeholder";
        return ph;
    };

    if (thumb) {
        const img = document.createElement("img");
        img.className = "thumb";
        img.src = thumb;
        img.alt = "";
        img.loading = "lazy";
        img.onerror = () => img.replaceWith(makePlaceholder());
        thumbWrap.appendChild(img);
    } else {
        thumbWrap.appendChild(makePlaceholder());
    }

    // footer: checkbox + title
    const footer = document.createElement("div");
    footer.className = "card-footer";

    const label = document.createElement("label");
    label.className = "done-check";
    label.title = "Mark as done";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isDone(url);

    const box = document.createElement("span");
    box.className = "box";

    label.appendChild(checkbox);
    label.appendChild(box);

    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = name;

    footer.appendChild(label);
    footer.appendChild(title);

    // reflect initial state + wire toggle
    li.classList.toggle("done", checkbox.checked);
    checkbox.addEventListener("change", () => {
        setDone(url, checkbox.checked);
        li.classList.toggle("done", checkbox.checked);
    });

    li.appendChild(link);
    li.appendChild(thumbWrap);
    li.appendChild(footer);
    return li;
}

// ---------- recursive list renderer ----------

function renderList(items) {
    const ul = document.createElement("ul");
    ul.className = "card-grid";

    for (const item of items) {
        const [name, value] = Object.entries(item)[0];

        if (Array.isArray(value)) {
            // subcategory → collapsible <details>, spans the full row
            const li = document.createElement("li");
            li.className = "category";

            const details = document.createElement("details");
            const summary = document.createElement("summary");
            summary.textContent = name;
            details.appendChild(summary);
            details.appendChild(renderList(value));
            li.appendChild(details);
            ul.appendChild(li);
        } else {
            ul.appendChild(createCard(name, value));
        }
    }
    return ul;
}

// ---------- top-level renderer ----------

function render(data) {
    const container = document.querySelector(".sections");
    container.innerHTML = "";

    for (const [sectionName, items] of Object.entries(data)) {
        const section = document.createElement("section");
        const h2 = document.createElement("h2");
        h2.textContent = sectionName;
        section.appendChild(h2);
        section.appendChild(renderList(items));
        container.appendChild(section);
    }
}

// ---------- kick off ----------

getData("website.json")
    .then(render)
    .catch((err) => {
        console.error(err);
        document.querySelector(".sections").textContent =
            "Failed to load games. Check the console.";
    });