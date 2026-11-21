import { decodeSharedDay } from "./core/shared-day.js";

const status = document.getElementById("day-status");
const list = document.getElementById("day-visits");
const print = document.getElementById("print-day");
print.onclick = () => window.print();

function render() {
  list.replaceChildren();
  print.hidden = true;
  try {
    const view = decodeSharedDay(location.hash);
    status.textContent = view.date + " · Japan time";
    for (const { name, time } of view.visits) {
      const row = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = name;
      row.append(title, document.createElement("br"), document.createTextNode(time));
      list.append(row);
    }
    if (!view.visits.length) status.textContent += " · No shared visits";
    print.hidden = false;
  } catch {
    status.textContent = "This link does not contain a valid shared day.";
  }
}

window.addEventListener("hashchange", render);
render();
