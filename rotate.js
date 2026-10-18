// Turning the map (alex, 2026-10-17: "make it so we can rotate the map"). The turning itself is leaflet-rotate
// (loaded just before this file); this adds what the app needs on top:
// - a twist with two fingers on a phone, only once it's clearly a twist (a pinch to zoom never turns the map a bit, even
//   when the fingers drift round as they spread);
// - right-drag, or Ctrl+drag, with a mouse: the map turns with the pointer around the middle of the map;
// - a compass button under the zoom buttons: its needle points north, a tap turns the map back to north up.
//   On a phone it only shows while the map is turned (or in Ride mode). In Ride mode navigate.js uses it to switch
//   between north up and facing the way you're going (tfRotate.onCompass);
// - our own panes (map.createPane) turn with the map, and pins and labels added to them go into a twin pane that
//   doesn't turn, so names stay level and pins stay upright and in place.
// The map fires "rotatestart" and "rotateend" around a turn made by the person ({ user: true }).

// When the button goes up where the page never hears it (over the browser's own right-click menu, another window,
// after switching apps mid-drag), the map's drag stayed on and the map followed the pointer with no button held
// (alex, 2026-10-18: "the map stick to my cursor and the map move without clicking"). The next move with no button
// down, a new press, or the window losing focus now ends it.
(() => {
  "use strict";
  if (!window.L || !L.Draggable) return;
  const Drag = L.Draggable.prototype, dragMove = Drag._onMove, dragDown = Drag._onDown;
  Drag._onMove = function (e) {
    if (e.type === "mousemove" && e.buttons === 0 && L.Draggable._dragging === this) { this.finishDrag(true); return; }
    dragMove.call(this, e);
  };
  Drag._onDown = function (e) {
    let was = L.Draggable._dragging;
    if (was === this && this._tfMouse && e.type === "mousedown") { this.finishDrag(true); was = null; }   // its release was missed
    dragDown.call(this, e);
    if (was !== this && L.Draggable._dragging === this) this._tfMouse = e.type === "mousedown";   // (a pen's drag also sends a mousedown)
  };
  window.addEventListener("blur", () => { if (L.Draggable._dragging) L.Draggable._dragging.finishDrag(true); });
})();

(() => {
  "use strict";
  if (!window.L || !L.Map.prototype.setBearing) return;   // leaflet-rotate didn't load: the map just doesn't turn
  const TWIST_DEG = 12;   // two fingers must turn this far before the map starts turning with them
  const PINCH_LOCK = 1.25;   // ...and before the pinch has zoomed by this much (in or out), or it's a zoom and never turns
  const PINCH_START = Math.log(1.05);   // fingers must spread or close 5% before the map starts to zoom

  const norm = (d) => ((d % 360) + 540) % 360 - 180;   // -180..180
  window.tfRotate = { onCompass: null };

  // ---------- panes: ours turn with the map, the pins and labels in them don't ----------
  const createPane = L.Map.prototype.createPane;
  const layerPane = L.Layer.prototype.getPane;
  L.Marker.include({
    getPane(name) {
      const p = layerPane.call(this, name), map = this._map;
      if (!p || !map || !map._rotatePane || p.parentNode !== map._rotatePane) return p;
      const twin = (name ? this.options[name] || name : this.options.pane) + "Pins";
      if (!map.getPane(twin)) {
        const t = createPane.call(map, twin, map._norotatePane);
        t.style.zIndex = p.style.zIndex; t.style.pointerEvents = p.style.pointerEvents;
      }
      return map.getPane(twin);
    },
  });

  // ---------- trail lines: redrawn while turning only when a corner of the screen would go past their canvas ----------
  // Their canvases turn with the map anyway; the redraw only fills in the corners that come into view. Each redraw costs
  // a frame or more on a phone (alex, 2026-10-18: "when you zoom and rotate it lag"), so it only happens once a corner
  // of the screen is about to leave the canvas, and then draws a canvas wide enough for the screen at any angle, so
  // that one turn needs it once at most. The next pan or zoom goes back to the usual size.
  // Not while a pinch is zooming the map (alex, 2026-10-18: "it is weird when you zoom in and out"): the lines are still
  // worked out for the zoom the pinch started at, so a redraw then drew them at that old size over a map that was
  // already bigger or smaller, bunched up or spread out, until the pinch ended. The redraw at the end fills the corners.
  const covers = (map, b) => {
    const s = map.getSize();
    return [[0, 0], [s.x, 0], [0, s.y], [s.x, s.y]].every((c) => b.contains(map.containerPointToLayerPoint(c)));
  };
  const rendererEvents = L.Renderer.prototype.getEvents, rendererUpdate = L.Renderer.prototype._update;
  L.Renderer.include({
    getEvents() {
      const ev = rendererEvents.call(this);
      if (ev.rotate) {
        const update = ev.rotate;
        ev.rotate = this._turnLater || (this._turnLater = L.Util.throttle(function () {
          const map = this._map;
          if (!map || map._animatingZoom || map.getZoom() !== this._zoom) return;
          if (this._bounds && covers(map, this._bounds)) return;
          this._wide = true;
          try { update.call(this); } finally { this._wide = false; }
        }, 100, this));
      }
      return ev;
    },
    _update() {
      rendererUpdate.call(this);
      const map = this._map;
      if (!this._wide || !map || !map._rotate) return;
      const s = map.getSize(), half = Math.ceil(Math.hypot(s.x, s.y) / 2 + Math.max(s.x, s.y) * 0.1);
      const c = map.containerPointToLayerPoint(s.divideBy(2)).round();
      this._bounds = L.bounds(c.subtract([half, half]), c.add([half, half]));
      this._topLeft = map.layerPointToLatLng(this._bounds.min);
    },
  });

  // ---------- two fingers: pinch to zoom, twist to turn ----------
  const angleOf = (map, e) => {
    const a = map.mouseEventToContainerPoint(e.touches[0]), b = map.mouseEventToContainerPoint(e.touches[1]);
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  };
  L.Map.TouchGestures.include({
    _onTouchStart(e) {
      const map = this._map;
      if (!e.touches || e.touches.length !== 2 || map._animatingZoom || this._zooming || this._rotating) return;
      const p1 = map.mouseEventToContainerPoint(e.touches[0]), p2 = map.mouseEventToContainerPoint(e.touches[1]);
      this._centerPoint = map.getSize()._divideBy(2);
      this._startLatLng = map.containerPointToLatLng(this._centerPoint);
      this._zooming = !!this.zoom;
      if (this._zooming) {
        if (map.options.touchZoom !== "center") this._pinchStartLatLng = map.containerPointToLatLng(p1.add(p2)._divideBy(2));
        this._startDist = this._firstDist = p1.distanceTo(p2);
        this._startZoom = map.getZoom();
      }
      this._rotating = !!this.rotate;
      this._startAngle = angleOf(map, e);
      this._startBearing = map.getBearing();
      this._twist = 0;            // 0 until the fingers have turned TWIST_DEG, then +-TWIST_DEG (taken off so the map doesn't jump)
      this._moved = false;
      map._stop();
      L.DomEvent.on(document, "touchmove", this._onTouchMove, this).on(document, "touchend touchcancel", this._onTouchEnd, this);
      L.DomEvent.preventDefault(e);
    },
    _onTouchMove(e) {
      if (!e.touches || e.touches.length !== 2 || !(this._zooming || this._rotating)) return;
      const map = this._map;
      const p1 = map.mouseEventToContainerPoint(e.touches[0]), p2 = map.mouseEventToContainerPoint(e.touches[1]);
      // A pinch that has already zoomed clearly is a zoom: fingers drifting round as they spread don't turn the map then.
      const dist = p1.distanceTo(p2);
      if (this._zooming && !this._twist) { const s = dist / this._firstDist; if (s > PINCH_LOCK || s < 1 / PINCH_LOCK) this._rotating = false; }
      if (this._rotating) {
        const d = norm(angleOf(map, e) - this._startAngle);
        if (!this._twist && Math.abs(d) > TWIST_DEG) { this._twist = d > 0 ? TWIST_DEG : -TWIST_DEG; map.fire("rotatestart", { user: true }); }
        if (this._twist) map.setBearing(this._startBearing + d - this._twist);
      }
      // The map only starts to zoom once the fingers have spread or closed a little (alex, 2026-10-18: "when you zoom
      // and rotate it lag"). A twist alone then never zooms, so letting go doesn't redo every trail line for a new zoom
      // (a second or more on a phone with the whole region's trails), and the map doesn't creep with the fingers.
      // It starts from where the fingers are then, so it doesn't jump.
      if (this._zooming && !this._moved && map.options.touchZoom !== "center") {
        if (Math.abs(Math.log(dist / this._firstDist)) < PINCH_START) { L.DomEvent.preventDefault(e); return; }
        this._startDist = dist;
        this._pinchStartLatLng = map.containerPointToLatLng(p1.add(p2)._divideBy(2));
      }
      if (this._zooming) {
        const scale = dist / this._startDist;
        this._zoom = map.getScaleZoom(scale, this._startZoom);
        if (!map.options.bounceAtZoomLimits && ((this._zoom < map.getMinZoom() && scale < 1) || (this._zoom > map.getMaxZoom() && scale > 1))) this._zoom = map._limitZoom(this._zoom);
        if (map.options.touchZoom === "center") this._center = this._startLatLng;
        else {
          const delta = p1._add(p2)._divideBy(2)._subtract(this._centerPoint);
          this._center = map.unproject(map.project(this._pinchStartLatLng).subtract(delta.rotate(-map.getBearing() * L.DomUtil.DEG_TO_RAD)));
        }
        if (!this._moved) { map._moveStart(true, false); this._moved = true; }
        L.Util.cancelAnimFrame(this._animRequest);
        this._animRequest = L.Util.requestAnimFrame(map._move.bind(map, this._center, this._zoom, { pinch: true, round: false }, undefined), this, true);
      }
      L.DomEvent.preventDefault(e);
    },
    _onTouchEnd() {
      const map = this._map, moved = this._moved, zooming = this._zooming;
      L.Util.cancelAnimFrame(this._animRequest);
      L.DomEvent.off(document, "touchmove", this._onTouchMove, this).off(document, "touchend touchcancel", this._onTouchEnd, this);
      if (this._twist) map.fire("rotateend", { user: true });
      this._zooming = this._rotating = this._moved = false; this._twist = 0;
      if (!moved || !zooming) return;
      if (map.options.zoomAnimation) map._animateZoom(this._center, map._limitZoom(this._zoom), true, map.options.zoomSnap);
      else map._resetView(this._center, map._limitZoom(this._zoom));
    },
  });

  // ---------- mouse: right-drag or Ctrl+drag turns the map ----------
  // A right-click that doesn't drag still reaches the map as a right-click (Skiing uses it to add a point).
  function mouseRotate(map) {
    const box = map.getContainer();
    let down = null, replaying = false, lastTurn = 0;
    const angleAt = (e) => { const r = box.getBoundingClientRect(); return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) * 180 / Math.PI; };
    const onMove = (e) => {
      if (!down) return;
      if (e.buttons === 0) { onUp(null); return; }   // the button went up where we didn't hear it: stop turning
      if (!down.moved) {
        if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 5) return;
        down.moved = true; box.classList.add("map-turning"); map.fire("rotatestart", { user: true });
      }
      const r = box.getBoundingClientRect();
      if (Math.hypot(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2) < 24) return;   // too near the middle to tell
      map.setBearing(down.bearing + norm(angleAt(e) - down.angle));
      e.preventDefault();
    };
    const onUp = (e) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const d = down; down = null;
      if (!d) return;
      if (d.moved) { lastTurn = Date.now(); box.classList.remove("map-turning"); map.fire("rotateend", { user: true }); return; }
      if (d.menu && e) {                                   // the click's own right-click, held back until we knew it wasn't a drag
        replaying = true;
        d.menu.target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: d.menu.x, clientY: d.menu.y, screenX: d.menu.sx, screenY: d.menu.sy, button: 2, ctrlKey: d.menu.ctrl, view: window }));
        replaying = false;
      }
    };
    box.addEventListener("mousedown", (e) => {
      if (!(e.button === 2 || (e.button === 0 && e.ctrlKey)) || e.target.closest(".leaflet-control, .leaflet-popup") || !map.options.rotate) return;
      if (box.classList.contains("drawing")) return;   // drawing a square to find trails
      if (e.button === 0) { e.stopPropagation(); e.preventDefault(); }   // Ctrl+drag: turn, don't pan
      if (down) onUp(null);                            // the last turn's release was missed
      down = { x: e.clientX, y: e.clientY, angle: angleAt(e), bearing: map.getBearing(), moved: false, menu: null };
      map._stop();
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }, true);
    box.addEventListener("contextmenu", (e) => {
      if (replaying) return;
      if (down) {                                     // Mac and Linux send it on the press: hold it until the release
        e.preventDefault(); e.stopPropagation();
        down.menu = { target: e.target, x: e.clientX, y: e.clientY, sx: e.screenX, sy: e.screenY, ctrl: e.ctrlKey };
      } else if (Date.now() - lastTurn < 400) { e.preventDefault(); e.stopPropagation(); }   // Windows sends it after a drag
    }, true);
  }

  // ---------- turning back to north (or to any bearing), smoothly ----------
  L.Map.include({
    turnTo(deg, ms = 300) {
      cancelAnimationFrame(this._turnAnim);
      const from = this.getBearing(), d = norm(deg - from);
      if (Math.abs(d) < 0.5 || !ms) { this.setBearing(deg); this.fire("rotateend"); return this; }
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms), ease = 1 - Math.pow(1 - k, 3);
        this.setBearing(from + d * ease);
        if (k < 1) this._turnAnim = requestAnimationFrame(step); else this.fire("rotateend");
      };
      this._turnAnim = requestAnimationFrame(step);
      return this;
    },
  });

  // ---------- the "Sharp outdoor (vector)" map style (leaflet-maplibre-gl, loaded on first use) ----------
  // Its MapLibre canvas sits in the turning tile pane, so it turns with the map, but the add-on places the canvas from
  // the screen's top-left corner and the map's north-up box, which are off once the map is turned. Place it around
  // the middle of the screen instead, and make it big enough to fill the corners of a turned screen.
  function glPatch() {
    const P = L.MaplibreGL && L.MaplibreGL.prototype;
    if (!P || P._tfTurn) return;
    P._tfTurn = true;
    const topLeft = (g) => g._map.containerPointToLayerPoint(g._map.getSize().divideBy(2)).subtract(g.getSize().divideBy(2))._round();
    P._initContainer = function () {
      this._container = L.DomUtil.create("div", "leaflet-gl-layer");
      this._resizeContainer();
      L.DomUtil.setPosition(this._container, (this._tl = topLeft(this)));
    };
    P._update = function () {
      if (!this._map) return;
      this._offset = this._map.containerPointToLayerPoint([0, 0]);
      if (this._zooming) return;
      L.DomUtil.setPosition(this._container, (this._tl = topLeft(this)));
      this._transformGL(this._glMap);
    };
    P._animateZoom = function (e) {
      const map = this._map, tl = this._tl || topLeft(this);
      const at = map._latLngToNewLayerPoint(map.layerPointToLatLng(tl), e.zoom, e.center).subtract(tl);
      L.DomUtil.setTransform(this._glMap._actualCanvas, at, map.getZoomScale(e.zoom));
    };
    P._transitionEnd = function () {
      L.Util.requestAnimFrame(function () {
        if (!this._map || !this._glMap) return;
        this._resizeContainer();
        L.DomUtil.setTransform(this._glMap._actualCanvas, L.point(0, 0), 1);
        this._glMap.once("moveend", L.Util.bind(this._zoomEnd, this));
        this._glMap.jumpTo({ center: this._map.getCenter(), zoom: this._map.getZoom() - 1 });
      }, this);
    };
  }
  // Extra canvas around the screen (as a share of its size) so a screen turned by the map's bearing stays covered.
  function glPadding(map) {
    const b = map.getBearing() * Math.PI / 180, s = map.getSize(), c = Math.abs(Math.cos(b)), n = Math.abs(Math.sin(b));
    const need = Math.max(((s.x * c + s.y * n) / s.x - 1) / 2, ((s.x * n + s.y * c) / s.y - 1) / 2);
    return Math.max(0.1, Math.ceil((need + 0.04) * 20) / 20);
  }
  function glTrack(map) {
    const gls = new Set();
    const addLayer = map.addLayer;
    map.addLayer = function (layer) {
      glPatch();
      if (L.MaplibreGL && layer instanceof L.MaplibreGL) {
        gls.add(layer); layer.options.padding = glPadding(map);
        layer._throttledUpdate = L.Util.throttle(layer._update, layer.options.updateInterval, layer);   // made before the patch
      }
      return addLayer.apply(this, arguments);
    };
    map.on("layerremove", (e) => gls.delete(e.layer));
    const fit = (shrink) => gls.forEach((g) => {
      if (!g._map || !g._glMap) return;
      const want = glPadding(map), cur = g.options.padding;
      if (want > cur || (shrink && want < cur)) { g.options.padding = want; g._resize(); }
    });
    const grow = L.Util.throttle(() => fit(false), 250);
    map.on("rotate", grow).on("rotateend resize", () => fit(true));
  }

  // ---------- compass button ----------
  const Compass = L.Control.extend({
    options: { position: "topleft" },
    onAdd(map) {
      const d = L.DomUtil.create("div", "leaflet-bar rotate-ctl north");
      d.innerHTML = `<a href="#" role="button"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g class="needle"><path d="M12 2.5 16 12h-8z" fill="#d6202a"/><path d="M12 21.5 8 12h8z" fill="currentColor" opacity=".45"/></g></svg></a>`;
      L.DomEvent.disableClickPropagation(d);
      this._a = d.firstChild; this._needle = d.querySelector(".needle");
      this._a.addEventListener("click", (e) => {
        e.preventDefault();
        if (window.tfRotate.onCompass && window.tfRotate.onCompass()) return;   // Ride mode: north up / facing my way
        map.turnTo(0);
      });
      map.on("rotate", this._sync, this);
      this._map = map; this._sync();
      return d;
    },
    onRemove(map) { map.off("rotate", this._sync, this); },
    _sync() {
      const b = this._map.getBearing(), north = Math.abs(norm(b)) < 0.5, c = this._container;
      this._needle.setAttribute("transform", `rotate(${b.toFixed(1)} 12 12)`);
      if (!c) return;
      c.classList.toggle("north", north);
      const label = c.dataset.label || (north ? "Map faces north. Turn it with two fingers, or right-drag (Ctrl+drag) with a mouse" : "Turn the map back to north up");
      this._a.title = label; this._a.setAttribute("aria-label", label);
    },
    setMode(label, on) {   // Ride mode sets its own words and lights the button while the map faces your way
      const c = this._container;
      if (label) c.dataset.label = label; else delete c.dataset.label;
      c.classList.toggle("on", !!on);
      this._sync();
    },
  });

  L.Map.addInitHook(function () {
    if (!this.options.rotate) return;
    const map = this;
    // leaflet-rotate swaps in its own pinch handler (TouchGestures, above) but Leaflet's own pinch zoom was added to
    // the map before that and stays on: every pinch was zoomed twice over, by two handlers fighting over where the
    // middle of the map is (Leaflet's doesn't know the map is turned), and every trail line redone twice when it ended.
    map._handlers.filter((h) => h !== map.touchGestures && h !== map.touchZoom && h._onTouchStart && h._onTouchEnd && h._onTouchMove).forEach((h) => {
      h.disable();
      map._handlers.splice(map._handlers.indexOf(h), 1);
    });
    // Our own panes turn with the map unless told otherwise.
    map.createPane = function (name, container) { return createPane.call(this, name, container || this._rotatePane); };
    mouseRotate(map);
    glTrack(map);
    map.compass = new Compass().addTo(map);
  });

  const css = document.createElement("style");
  css.textContent = `
.rotate-ctl a { display: grid; place-items: center; }
.leaflet-bar.rotate-ctl.on a, .leaflet-bar.rotate-ctl.on a:hover, .leaflet-bar.rotate-ctl.on a:focus { background: #2b7de9; color: #fff; }
.leaflet-container.map-turning { cursor: grabbing; }
@media (max-width: 760px) { .app:not(.riding) .rotate-ctl.north { display: none; } }
`;
  document.head.appendChild(css);
})();
