// --- Config ---
// Mapbox token is injected by Vercel Build Command to satisfy GitHub Push Protection.
const MAPBOX_TOKEN = "__MAPBOX_TOKEN__";

// --- Service Worker ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then(() => console.log("SW registered"))
      .catch((err) => console.log("SW failed", err));
  });
}

// --- Utility Functions ---
function getDistanceInMeters(pt1, pt2) {
  const R = 6371000;
  const dLat = ((pt2[1] - pt1[1]) * Math.PI) / 180;
  const dLon = ((pt2[0] - pt1[0]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((pt1[1] * Math.PI) / 180) *
      Math.cos((pt2[1] * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getClosestPointOnSegment(p, v, w) {
  const l2 = Math.pow(v[0] - w[0], 2) + Math.pow(v[1] - w[1], 2);
  if (l2 === 0) return v;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2,
    ),
  );
  return [v[0] + t * (w[0] - v[0]), v[1] + t * (w[1] - v[1])];
}

// --- Map Init ---
mapboxgl.accessToken = MAPBOX_TOKEN;
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/standard",
  center: [106.7, 10.77],
  zoom: 14,
  maxBounds: [
    [106.4929, 10.6706], // Southwest coordinates (approx from Feature 1)
    [106.8692, 10.8851], // Northeast coordinates (approx from Feature 1)
  ],
});

// --- Controls ---
map.addControl(new mapboxgl.NavigationControl(), "top-right");
const geolocate = new mapboxgl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
  showUserHeading: true,
});
map.addControl(geolocate, "top-right");

// Make map globally accessible for the landing page transition resize
window.mapInstance = map;

// --- Street View Control ---
let isStreetViewActive = true;
class StreetViewControl {
  onAdd(map) {
    this._map = map;
    this._container = document.createElement("div");
    this._container.className = "mapboxgl-ctrl mapboxgl-ctrl-group";
    this._btn = document.createElement("button");
    this._btn.type = "button";
    this._btn.title = "Toggle Street View";
    this._btn.style.width = "32px";
    this._btn.style.height = "32px";
    this._btn.style.display = "flex";
    this._btn.style.justifyContent = "center";
    this._btn.style.alignItems = "center";
    this._btn.style.cursor = "pointer";
    this._btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 3h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-5l-3 3-3-3H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke-linecap="round"/>
        <rect x="7" y="7" width="10" height="2" fill="currentColor" stroke="none"/>
        <rect x="7" y="11" width="6" height="2" fill="currentColor" stroke="none"/>
      </svg>
    `;

    this._updateStyle();

    this._btn.onclick = () => {
      isStreetViewActive = !isStreetViewActive;
      this._updateStyle();
      this._toggleLayer();
    };

    this._container.appendChild(this._btn);
    return this._container;
  }

  onRemove() {
    this._container.parentNode.removeChild(this._container);
    this._map = undefined;
  }

  _updateStyle() {
    this._btn.style.backgroundColor = isStreetViewActive ? "#3ab2e5" : "white";
    this._btn.style.color = isStreetViewActive ? "white" : "#3ab2e5";
  }

  _toggleLayer() {
    if (!this._map) return;
    const visibility = isStreetViewActive ? "visible" : "none";
    if (this._map.getLayer("streets-layer")) {
      this._map.setLayoutProperty("streets-layer", "visibility", visibility);
    }
    if (this._map.getLayer("streets-labels-layer")) {
      this._map.setLayoutProperty(
        "streets-labels-layer",
        "visibility",
        visibility,
      );
    }
    if (!isStreetViewActive && geoPopup) {
      geoPopup.remove();
    }
  }
}

map.addControl(new StreetViewControl(), "top-right");

// Trigger geolocation on the first tap
function onFirstInteraction() {
  geolocate.trigger();
  document.body.removeEventListener("click", onFirstInteraction);
  document.body.removeEventListener("touchstart", onFirstInteraction);
}
document.body.addEventListener("click", onFirstInteraction);
document.body.addEventListener("touchstart", onFirstInteraction, {
  passive: true,
});

// --- Audio Playback ---
let geoPopup = null;
let currentPlayingId = null;

const PLAY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 256 256"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm36.44-94.66-48-32A8,8,0,0,0,104,96v64a8,8,0,0,0,12.44,6.66l48-32a8,8,0,0,0,0-13.32ZM120,145.05V111l25.58,17Z"></path></svg>`;
const PAUSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 256 256"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216ZM112,96v64a8,8,0,0,1-16,0V96a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V96a8,8,0,0,1,16,0Z"></path></svg>`;

async function togglePlay(id, text) {
  const btn = document.getElementById(`play-btn-${id}`);
  if (!btn) return;

  if (currentPlayingId === id) {
    btn.innerHTML = PLAY_ICON;
    currentPlayingId = null;
    if (window.currentAudioObj) {
      window.currentAudioObj.pause();
      window.currentAudioObj = null;
    }
    return;
  }

  if (currentPlayingId !== null) {
    const oldBtn = document.getElementById(`play-btn-${currentPlayingId}`);
    if (oldBtn) oldBtn.innerHTML = PLAY_ICON;
    if (window.currentAudioObj) {
      window.currentAudioObj.pause();
      window.currentAudioObj = null;
    }
  }

  btn.innerHTML = PAUSE_ICON;
  currentPlayingId = id;

  try {
    const response = await fetch(
      `/api/tts?text=${encodeURIComponent(text || "No description available.")}`,
    );

    if (!response.ok) throw new Error(`HTTP error ${response.status}`);

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audioObj = new Audio(url);
    await audioObj.play();
    window.currentAudioObj = audioObj;

    audioObj.onended = () => {
      if (currentPlayingId === id) {
        btn.innerHTML = PLAY_ICON;
        currentPlayingId = null;
      }
      window.currentAudioObj = null;
      URL.revokeObjectURL(url);
    };
  } catch (error) {
    console.error("ElevenLabs error:", error);
    if (currentPlayingId === id) {
      btn.innerHTML = PLAY_ICON;
      currentPlayingId = null;
    }
  }
}
window.togglePlay = togglePlay;

// --- Map Load ---
map.on("load", async () => {
  const response = await fetch("demo.geojson");
  const data = await response.json();
  let selectedId = null;

  map.addSource("streets", { type: "geojson", data, generateId: true });

  const nameToIds = {};
  data.features.forEach((f, i) => {
    const name = f.properties.name || "";
    if (!nameToIds[name]) nameToIds[name] = [];
    nameToIds[name].push(i);
  });

  map.addLayer({
    id: "streets-layer",
    type: "line",
    source: "streets",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        "#2196F3",
        "#ff0000",
      ],
      "line-width": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        12,
        8,
      ],
      "line-opacity": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        0.8,
        0.5,
      ],
    },
  });

  map.addLayer({
    id: "streets-labels-layer",
    type: "symbol",
    source: "streets",
    layout: {
      "text-field": ["get", "name"],
      "text-transform": "uppercase",
      "symbol-placement": "line",
      "text-font": ["Open Sans Semibold"],
      "text-size": 13,
      "text-letter-spacing": 0.1,
      "text-max-angle": 30,
      "text-padding": 20,
      "text-keep-upright": true,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#000000",
      "text-halo-width": 1.5,
    },
  });

  function selectStreetAndShowPopup(feature, location) {
    const name = feature.properties.name || "";

    if (selectedId !== null) {
      selectedId.forEach((sid) =>
        map.setFeatureState(
          { source: "streets", id: sid },
          { selected: false },
        ),
      );
    }
    const ids = nameToIds[name] || [feature.id];
    ids.forEach((sid) =>
      map.setFeatureState({ source: "streets", id: sid }, { selected: true }),
    );
    selectedId = ids;

    if (geoPopup) geoPopup.remove();
    const p = feature.properties;
    geoPopup = new mapboxgl.Popup({ maxWidth: "280px" })
      .setLngLat(location)
      .setHTML(
        `<div style="display: flex; flex-direction: column; gap: 8px; width: 240px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <h3 style="margin: 0; font-size: 18px; font-weight: 800; color: #111; letter-spacing: -0.025em; font-family: 'Roboto', -apple-system, sans-serif; text-transform: uppercase; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.name || "Unnamed"}</h3>
            <div id="play-btn-${p.id || p["@id"]}" class="play-button" style="cursor: pointer; color: #2196F3; flex-shrink: 0; display: flex; align-items: center; transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1); filter: drop-shadow(0 2px 4px rgba(33, 150, 243, 0.2));" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'" onclick="togglePlay('${p.id || p["@id"]}', \`${p.description || ""}\`)">
              <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" fill="currentColor" viewBox="0 0 256 256"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm36.44-94.66-48-32A8,8,0,0,0,104,96v64a8,8,0,0,0,12.44,6.66l48-32a8,8,0,0,0,0-13.32ZM120,145.05V111l25.58,17Z"></path></svg>
            </div>
          </div>
          <p style="margin: 0; font-size: 13px; line-height: 1.55; color: #334155; font-weight: 500;">${p.description || "A charming street with a unique story waiting to be discovered."}</p>
        </div>`,
      )
      .addTo(map);

    map.flyTo({
      center: location,
      duration: 900,
      curve: 1.42,
      essential: true,
    });
  }

  map.on("click", "streets-layer", (e) => {
    if (e.features.length > 0)
      selectStreetAndShowPopup(e.features[0], e.lngLat);
  });

  map.on(
    "mouseenter",
    "streets-layer",
    () => (map.getCanvas().style.cursor = "pointer"),
  );
  map.on(
    "mouseleave",
    "streets-layer",
    () => (map.getCanvas().style.cursor = ""),
  );

  geolocate.on("geolocate", (pos) => {
    const userLngLat = [pos.coords.longitude, pos.coords.latitude];
    let minDistance = Infinity;
    let closestIdx = -1;
    let closestPoint = null;

    data.features.forEach((f, i) => {
      if (f.geometry && f.geometry.type === "LineString") {
        const coords = f.geometry.coordinates;
        for (let j = 0; j < coords.length - 1; j++) {
          const pOnSeg = getClosestPointOnSegment(
            userLngLat,
            coords[j],
            coords[j + 1],
          );
          const dist = getDistanceInMeters(userLngLat, pOnSeg);
          if (dist < minDistance) {
            minDistance = dist;
            closestIdx = i;
            closestPoint = pOnSeg;
          }
        }
      }
    });

    if (closestIdx >= 0 && minDistance <= 50) {
      selectStreetAndShowPopup(data.features[closestIdx], closestPoint);
    }
  });

  const bounds = new mapboxgl.LngLatBounds();
  data.features.forEach((f) => {
    if (!f.geometry) return;
    let coords = [];
    if (f.geometry.type === "Point") coords = [f.geometry.coordinates];
    else if (f.geometry.type === "LineString") coords = f.geometry.coordinates;
    else if (
      f.geometry.type === "Polygon" ||
      f.geometry.type === "MultiLineString"
    )
      coords = f.geometry.coordinates.flat(1);
    else if (f.geometry.type === "MultiPolygon")
      coords = f.geometry.coordinates.flat(2);
    coords.forEach((c) => bounds.extend(c));
  });
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40 });
});
