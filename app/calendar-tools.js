import nihombashi from "./nihombashi-event.js";
import { readBounded } from "./core/shopping-bundle.js";

export const calendarURL = "https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html";
const jmaWeather = "https://www.jma.go.jp/jma/kokusai/multi.html";
const gaugeViewer = "https://www.jma.go.jp/bosai/amedas/";
const gaugeData = gaugeViewer + "data/";
const jmaTerms = "https://www.jma.go.jp/jma/kishou/info/coment.html";
const eventDerivative = new URL("../data/events/2027/edo-tokyo-festival-pin-2027.json", import.meta.url);
const eventAttribution = 'Festival building location © <a href="' + nihombashi.geometrySource.attributionUrl +
  '">OpenStreetMap contributors</a> · <a href="' + nihombashi.geometrySource.licenseUrl + '">ODbL</a>';
const eventOn = (date) => nihombashi.startDate <= date && date <= nihombashi.endDate;
const pdl = "https://www.digital.go.jp/resources/open_data/public_data_license_v1.0";
const sharedHolidays = {
  "01-01": "New Year’s Day", "02-11": "National Foundation Day", "02-23": "Emperor’s Birthday",
  "04-29": "Shōwa Day", "05-03": "Constitution Memorial Day", "05-04": "Greenery Day",
  "05-05": "Children’s Day", "08-11": "Mountain Day", "09-23": "Autumnal Equinox Day",
  "11-03": "Culture Day", "11-23": "Labor Thanksgiving Day",
};
const annualHolidays = {
  "2026": { "01-12": "Coming of Age Day", "03-20": "Vernal Equinox Day", "05-06": "Substitute holiday",
    "07-20": "Marine Day", "09-21": "Respect for the Aged Day", "09-22": "Statutory holiday between national holidays",
    "10-12": "Sports Day" },
  "2027": { "01-11": "Coming of Age Day", "03-21": "Vernal Equinox Day", "03-22": "Substitute holiday",
    "07-19": "Marine Day", "09-20": "Respect for the Aged Day", "10-11": "Sports Day" },
};
const seasons = [
  { city: "Tokyo", point: [35.681, 139.767], cherry: ["03-24", "03-31"], maple: ["11-28", "12-13"],
    urls: ["https://www.data.jma.go.jp/tokyo/shosai/kanyoho/sakura/sakura.html",
      "https://www.data.jma.go.jp/sakura/data/pdf/015.pdf#page=8", "https://www.data.jma.go.jp/sakura/data/pdf/016.pdf#page=8"] },
  { city: "Sendai", point: [38.26, 140.882], cherry: ["04-08", "04-13"], maple: ["11-21", "12-06"],
    urls: ["https://www.data.jma.go.jp/sendai/data/tenkou/seibutu-kankouki.html"] },
  { city: "Yamagata", point: [38.249, 140.328], cherry: ["04-13", "04-18"], maple: ["11-25", "12-09"],
    urls: ["https://www.data.jma.go.jp/yamagata/detail/phenology.html"] },
  { city: "Kyoto", point: [34.986, 135.759], cherry: ["03-26", "04-04"], maple: ["12-05", "12-18"],
    urls: ["https://www.data.jma.go.jp/kyoto/2_data/seibutsu/index.html"] },
  { city: "Osaka", point: [34.702, 135.496], cherry: ["03-27", "04-04"], maple: ["12-01", "12-13"],
    urls: ["https://www.data.jma.go.jp/osaka/kansoku/seibutsukisetsu.html"] },
];
const events = [
  { dates: [nihombashi.startDate, nihombashi.endDate], title: "Tokyo · " + nihombashi.name + " · " + nihombashi.venue,
    url: nihombashi.eventSourceUrl },
  { dates: ["2027-01-10", "2027-01-10"], title: "Yamagata · Hatsuichi New Year market on Route 112 · 10:00–17:00",
    url: "https://www.yamagata-cci.or.jp/user/eve/ev_hatu.html" },
  { dates: ["2027-09-20", "2027-12-31"], title: "Tokyo · Edo Tokyo Cultural Festival umbrella program · several venues",
    url: "https://www.bunka.go.jp/koho_hodo_oshirase/hodohappyo/94446001.html" },
];
const regions = [
  ["Tokyo mainland", "130000", "130010"], ["East Miyagi (Sendai and Matsushima)", "040000", "040010"],
  ["Murayama (Yamagata)", "060000", "060010"], ["South Kyoto", "260000", "260010"], ["Osaka", "270000", "270000"],
];

const gauges = [["Tokyo", "44132"], ["Sendai", "34392"], ["Yamagata", "35426"], ["Kyoto", "61286"], ["Osaka", "62078"]];
const freshObservationMs = 35 * 60000;
const anonymous = (target, init) =>
  fetch(target, { ...init, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });

const jstDate = (date = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(date);
const prettyMonth = (end) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date("2026-" + end));

export function holidayOn(date) {
  const year = date.slice(0, 4), md = date.slice(5);
  if (!annualHolidays[year]) return null;
  return annualHolidays[year][md] || sharedHolidays[md] || null;
}

function travelPeriod(date) {
  const md = date.slice(5);
  if (md >= "04-29" && md <= (date.startsWith("2026") ? "05-06" : "05-05")) return "Golden Week travel period";
  if (md >= "08-13" && md <= "08-16") return "Mid-August Obon travel period (local dates vary)";
  if (md >= "12-29" || md <= "01-03") return "New Year travel period";
  return "";
}

export function seasonalMatches(date) {
  if (!date) return [];
  const md = date.slice(5);
  return seasons.flatMap(item => ["cherry", "maple"].filter(type => item[type][0] <= md && md <= item[type][1])
    .map(type => ({ ...item, type })));
}

export function shortForecast(data, date, code, now = Date.now()) {
  const first = Array.isArray(data) && data[0];
  const issued = Date.parse(first?.reportDatetime);
  if (!Number.isFinite(issued) || issued > now + 10 * 60000 || now - issued > 15 * 3600000) return null;
  const blocks = first.timeSeries?.flatMap(series => {
    const area = series.areas?.find(item => item.area?.code === code && Array.isArray(item.pops));
    if (!area || !Array.isArray(series.timeDefines)) return [];
    return series.timeDefines.flatMap((start, index) => {
      const value = area.pops[index];
      const time = typeof start === "string" && /^(\d{4}-\d{2}-\d{2})T(00|06|12|18):00:00\+09:00$/.exec(start);
      if (!time || time[1] !== date || Date.parse(start) + 6 * 3600000 <= now || !/^(0|[1-9]0|100)$/.test(value || "")) return [];
      return [{ start: time[2], end: String(Number(time[2]) + 6).padStart(2, "0"), percent: Number(value) }];
    });
  });
  return blocks?.length ? { issued: new Date(issued), blocks } : null;
}

function parseGaugeStamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d[0]:00\+09:00$/.test(value)) return NaN;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return NaN;
  return new Date(time + 9 * 3600000).toISOString().slice(0, 19) === value.slice(0, 19) ? time : NaN;
}

export function observationBucket(timestamp) {
  const iso = new Date(timestamp + 9 * 3600000).toISOString();
  const hours = String(Math.floor(Number(iso.slice(11, 13)) / 3) * 3).padStart(2, "0");
  return iso.slice(0, 10).replaceAll("-", "") + "_" + hours;
}

export function rainObservation(data, latest, date, now = Date.now()) {
  const cutoff = parseGaugeStamp(latest);
  if (!Number.isFinite(cutoff) || cutoff > now + 2 * 60000 || now - cutoff > freshObservationMs) return null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const samples = [];
  for (const [key, row] of Object.entries(data)) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})([0-5]0)00$/.exec(key);
    if (!match) continue;
    const stamp = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+09:00`;
    const time = parseGaugeStamp(stamp);
    if (stamp.slice(0, 10) !== date || !Number.isFinite(time) || time > cutoff || time > now || now - time > freshObservationMs) continue;
    samples.push({ stamp, time, reading: row?.precipitation1h });
  }
  const observed = samples.sort((a,b) => b.time - a.time)[0];
  const reading = observed?.reading;
  if (!Array.isArray(reading) || reading[1] !== 0 || !Number.isFinite(reading[0]) || reading[0] < 0) return null;
  return { stamp: observed.stamp, mm: reading[0] };
}

export function createCalendarTools({ esc, modal, getDay, getState, render }) {
  let map, overlay, visible = false, renderedDate, eventShown = false;
  const link = (url, label) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  function milestone(item) {
    const [start, end] = item[item.type].map(prettyMonth);
    return item.type === "cherry" ? `First cherry blossoms ${start} · full bloom ${end}` :
      `Maple color change ${start} · leaf fall ${end}`;
  }

  function seasonHTML(item) {
    return `<li><strong>${esc(item.city)} observation station</strong><br>${esc(milestone(item))}<br>
      ${item.urls.map((url, i) => link(url, item.urls.length > 1 ? ["JMA cherry", "JMA maple color", "JMA maple leaf fall"][i] : "JMA station data")).join(" · ")}</li>`;
  }

  function daySection(day) {
    const holiday = holidayOn(day.date), period = travelPeriod(day.date);
    const matching = seasonalMatches(day.date);
    const localEvents = events.filter(event => event.dates[0] <= day.date && day.date <= event.dates[1]);
    return `<section class="calendar-day" aria-label="Season and holidays">
      ${holiday ? `<p><strong>Japan public holiday · ${esc(holiday)}</strong> · ${link(calendarURL, "Cabinet Office calendar")}</p>` : ""}
      ${period ? `<p>${esc(period)} · Check train and accommodation availability. ${link("https://www.japan.travel/", "JNTO")}</p>` : ""}
      <details><summary>Season, events &amp; weather</summary>
      ${!annualHolidays[day.date.slice(0, 4)] ? `<p>Bundled holiday dates cover 2026–2027. ${link(calendarURL, "Published holiday calendar")}</p>` : ""}
      ${matching.length ? `<p>Historical JMA specimen-tree milestones near this date · 1991–2020 normals. Timing varies by site and year.</p><ul>${matching.map(seasonHTML).join("")}</ul>` :
       "<p>No matching historical milestones in the five-station sample for this date.</p>"}
      ${localEvents.length ? `<ul>${localEvents.map(event => `<li>${esc(event.title)} · ${link(event.url, "Organizer dates")}</li>`).join("")}</ul>` : ""}
      <p>Japan Planner selected and formatted JMA normals and translated Cabinet Office dates. ${link(jmaTerms, "JMA terms")} · ${link(pdl, "Public Data License 1.0")}</p>
      <button type="button" data-action="jma-forecast">Check JMA regional forecast</button>
      <button type="button" data-action="jma-observation">Check JMA rain observations</button> ${link(jmaWeather, "JMA multilingual weather")}</details></section>`;
  }

  function tripSection(trip) {
    const ids = new Set(trip.dayIds);
    const dates = getState().days.filter(day => ids.has(day.id)).map(day => day.date);
    const periods = [...new Set(dates.map(travelPeriod).filter(Boolean))];
    const overlap = [...new Set(dates.flatMap(date => seasonalMatches(date))
      .map(item => item.city + " " + (item.type === "cherry" ? "cherry" : "maple")))];
    if (!periods.length && !overlap.length) return "";
    return `<div class="calendar-trip">
      ${periods.length ? `<p>${esc(periods.join(" · "))}. Check train and accommodation availability. ${link("https://www.japan.travel/", "JNTO")}</p>` : ""}
      ${overlap.length ? `<p>Dates overlap JMA’s 1991–2020 specimen-tree references · ${esc(overlap.join(", "))}. See the matching day for locations and dates.</p>` : ""}</div>`;
  }

  function layerSection() {
    return `<button type="button" data-action="season-layer" aria-pressed="${visible}" ${getDay() ? "" : "disabled"}>Season &amp; events on trip date</button>
      ${visible ? '<p class="muted">City reference points for five JMA specimen trees. 1991–2020 averages. Local timing varies.</p>' : ""}
      ${visible && eventOn(getDay()?.date) ? '<button type="button" data-action="map-festival">Find Nihombashi festival pin</button>' : ""}`;
  }

  function syncMap() {
    const date = visible ? getDay()?.date || null : null;
    if (!map || renderedDate === date) return;
    renderedDate = date;
    if (overlay) { map.removeLayer(overlay); overlay = null; }
    if (eventShown) {
      map.attributionControl.removeAttribution(eventAttribution);
      eventShown = false;
    }
    if (!date) return;
    overlay = L.layerGroup().addTo(map);
    for (const item of seasonalMatches(date)) {
      const name = item.city + " · " + (item.type === "cherry" ? "Cherry blossoms" : "Maple");
      const symbol = item.type === "cherry" ? "🌸" : "🍁";
      const icon = L.divIcon({ className: "station-marker seasonal-marker", html: `<span aria-hidden="true">${symbol}</span>`,
        iconSize: [27, 27], iconAnchor: [13, 13] });
      const marker = L.marker(item.point, { icon, keyboard: true, title: name }).addTo(overlay);
      marker.getElement()?.setAttribute("aria-label", name);
      marker.on("click", () => modal(name, `<p>Historical specimen-tree milestones, 1991–2020. Site and year affect timing.</p>
        <ul>${seasonHTML(item)}</ul><p>${link(jmaTerms,"JMA terms")} · ${link(pdl,"Public Data License 1.0")}</p>`));
    }
    if (eventOn(date)) {
      const marker = L.marker([nihombashi.lat, nihombashi.lon], {
        icon: L.divIcon({ className: "station-marker festival-marker",
          html: '<span aria-hidden="true">祭</span>', iconSize: [27, 27], iconAnchor: [13, 13] }),
        zIndexOffset: 900, keyboard: true, title: nihombashi.name,
      }).addTo(overlay);
      const element = marker.getElement();
      element?.setAttribute("aria-label", nihombashi.name);
      const openEvent = () => modal(nihombashi.name, `
        <p>${esc(nihombashi.startDate)} to ${esc(nihombashi.endDate)} · Japan time</p>
        <p><strong>${esc(nihombashi.venue)}</strong><br>${esc(nihombashi.address)}</p>
        <p>${esc(nihombashi.mapLabel)}. Check the venue guide for the indoor hall.</p>
        <p>${link(nihombashi.eventSourceUrl, "Tokyo Metropolitan Government announcement")} ·
          ${link(nihombashi.venueSourceUrl, "Venue access")}</p>
        <p>${link(nihombashi.geometrySource.attributionUrl, "© OpenStreetMap contributors")} ·
          ${link(nihombashi.geometrySource.sourceUrl, "Mapped Main Building")} ·
          ${link(nihombashi.geometrySource.licenseUrl, "ODbL")} · ${link(eventDerivative, "Mapped point and sources (JSON)")}</p>`);
      marker.on("click", openEvent);
      element?.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          openEvent();
        }
      });
      map.attributionControl.addAttribution(eventAttribution);
      eventShown = true;
    }
  }

  function forecastDialog() {
    const date = getDay()?.date || jstDate();
    const today = jstDate(), tomorrow = jstDate(new Date(Date.now() + 86400000));
    const eligible = date === today || date === tomorrow;
    modal("JMA regional forecast", `<p>Forecast date in Japan · ${esc(date)}</p>
      <p>Choose a region to request JMA’s public forecast. Only that region’s public file is requested. Trip details and device location stay in this browser.</p>
      ${eligible ? `<label>Forecast region<select id="jma-region">${regions.map(([label], i) => `<option value="${i}">${label}</option>`).join("")}</select></label>
      <button type="button" id="jma-check">Load JMA forecast</button><div id="jma-result" role="status" aria-live="polite"></div>` :
      "<p>Six-hour forecasts are available for today and tomorrow in Japan, subject to JMA coverage.</p>"}
      <p>${link(jmaWeather, "JMA multilingual weather")} · ${link("https://www.jma.go.jp/jma/kishou/know/kurashi/yoho.html", "JMA forecast definitions")}</p>`, () => {
      const button = document.getElementById("jma-check");
      if (!button) return;
      const select = document.getElementById("jma-region");
      const result = document.getElementById("jma-result");
      button.onclick = async () => {
        const [label, fileCode, areaCode] = regions[Number(select.value)];
        const url = "https://www.jma.go.jp/bosai/forecast/data/forecast/" + fileCode + ".json";
        result.textContent = "Checking JMA…";
        button.disabled = select.disabled = true;
        try {
          const response = await readBounded(url, 300_000, null, anonymous, 8000);
          const forecast = shortForecast(JSON.parse(response.text), date, areaCode);
          if (!forecast) throw new Error("unavailable");
          const issued = forecast.issued.toLocaleString("en-GB", { timeZone: "Asia/Tokyo" });
          result.innerHTML = `<p><strong>${esc(label)}</strong> · Issued ${esc(issued)} Japan time</p>
            <p>Forecast probability of at least 1 mm of precipitation per six-hour block. Use local conditions for rain swaps.</p>
            <ul>${forecast.blocks.map(item => `<li>${item.start}:00–${item.end}:00 · ${item.percent}%</li>`).join("")}</ul>
            <p>${link(url, "JMA forecast data")} · ${link(jmaTerms, "JMA terms")}</p>`;
        } catch {
          result.textContent = "A current forecast is unavailable for this date and region. Check JMA online or use local conditions.";
        } finally {
          button.disabled = select.disabled = false;
        }
      };
    });
  }

  function observationDialog({ onBack, day } = {}) {
    const date = day?.date || getDay()?.date || jstDate();
    const eligible = date === jstDate();
    modal("JMA rain observations", `<p>Choose a named JMA gauge. The lookup sends the selected public station code. Device location and itinerary details stay in this browser.</p>
      ${eligible ? `<label>Observation station<select id="jma-gauge">${gauges.map(([name], i) => `<option value="${i}">${name}</option>`).join("")}</select></label>
      <button type="button" id="jma-observe">Load last-hour observation</button><div id="jma-observed" role="status" aria-live="polite"></div>` :
      "<p>Live gauge readings are available for today in Japan.</p>"}
      <p>${link(gaugeViewer, "JMA observation map")} · ${link(jmaTerms, "JMA terms")} · ${link(pdl, "Public Data License 1.0")}</p>
      ${onBack ? '<button type="button" id="jma-observation-back">Back to Now</button>' : ""}`, () => {
      document.getElementById("jma-observation-back")?.addEventListener("click", onBack);
      const button = document.getElementById("jma-observe");
      if (!button) return;
      const select = document.getElementById("jma-gauge");
      const result = document.getElementById("jma-observed");
      button.onclick = async () => {
        const [name, id] = gauges[Number(select.value)];
        button.disabled = select.disabled = true;
        result.textContent = "Checking JMA…";
        try {
          const index = await readBounded(gaugeData + "latest_time.txt", 128, null, anonymous, 5000);
          const latest = index.text.trim();
          const time = parseGaugeStamp(latest);
          const now = Date.now();
          if (!Number.isFinite(time) || time > now + 2 * 60000 || now - time > freshObservationMs) throw new Error("stale");
          const url = gaugeData + "point/" + id + "/" + observationBucket(time) + ".json";
          const file = await readBounded(url, 180_000, null, anonymous, 5000);
          const observed = rainObservation(JSON.parse(file.text), latest, date);
          if (!observed) throw new Error("unavailable");
          result.innerHTML = `<p><strong>JMA ${esc(name)} gauge · ${observed.mm.toFixed(1)} mm</strong> of observed precipitation in the hour ending ${esc(observed.stamp.slice(0, 16).replace("T", " "))} JST.</p>
            <p>${observed.mm > 0 ? "Precipitation was measured at this gauge. If it is raining at your stop, return to Now and confirm to review indoor options." :
              "The gauge measured zero for that hour. Check the conditions at your stop."}</p>
            <p>${link(url, "JMA station observation data")} · Selected and formatted by Japan Planner.</p>`;
        } catch {
          result.textContent = "Local rain data unavailable. Check your conditions directly before reviewing indoor options.";
        } finally {
          button.disabled = select.disabled = false;
        }
      };
    });
  }

  return { daySection, tripSection, layerSection, observationDialog, syncMap, attachMap(value) { map = value; syncMap(); }, actions: {
    "jma-forecast": forecastDialog,
    "jma-observation": () => observationDialog(),
    "map-festival": () => { if (visible && eventOn(getDay()?.date)) map?.setView([nihombashi.lat, nihombashi.lon], 16); },
    "season-layer": () => { visible = !visible; syncMap(); render(); },
  } };
}
