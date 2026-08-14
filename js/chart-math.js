// Pure, dependency-free maths shared by js/profile.js's renderProfileChart
// and the landing page's own demo chart (landing/script.js). No DOM, no
// app state — every function is deterministic from its arguments alone,
// which is exactly what makes it safe for a static marketing page to load
// verbatim rather than hand-copy. Colour SOURCES still differ per caller
// (the app reads live --warn/--danger/etc. via getComputedStyle in
// profile.js; landing passes its own hardcoded constants) — only the
// threshold/curve maths itself is shared.
//
// landing/prepare-shared.sh copies this file byte-for-byte into
// landing/chart-math.js at deploy time — see that script's own header for
// why (CLAUDE.md's PWA section records the mechanism). Never hand-edit
// landing/chart-math.js; it's regenerated, not written.

function _hexToRgb(color) {
  if (!color) return null;
  const c = color.toString().trim();

  // Parse rgb(r,g,b) / rgba(r,g,b,a) — calmHex and decoHex arrive as these
  const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) return { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] };

  // Parse hex (#abc or #aabbcc)
  const h = c.replace('#', '');
  if (!h || !/^[0-9a-f]{3,6}$/i.test(h)) return null;
  const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h;
  const n = parseInt(full, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function _hexLerp(hexA, hexB, frac) {
  const a = _hexToRgb(hexA);
  const b = _hexToRgb(hexB);
  if (!a || !b) return hexA;  // Fallback to first color, not black!

  const f = Math.max(0, Math.min(1, frac));
  const r = Math.round(a.r + (b.r - a.r) * f);
  const g = Math.round(a.g + (b.g - a.g) * f);
  const bl = Math.round(a.b + (b.b - a.b) * f);  // Renamed from bch to bl

  return `rgb(${r},${g},${bl})`;
}

// NDL headroom → curve colour. Thresholds are a deliberately gentle cue, not
// a decompression-safety instrument (DECISIONS.md — "one colour mechanic
// only") — calibrated to Luke's own stated reference points, not arbitrary
// round numbers: calm above 25 min, warming from there, full "time to head
// up" colour at 10 min (his own "that's when I start thinking about
// ascending"). The 15 min midpoint isn't stated explicitly — derived by
// preserving the original thresholds' 2:1 ratio between the two transition
// spans (was 10 min calm→warn span vs. 5 min warn→danger span, out of 0-15;
// same ratio applied to the new 10-25 span gives a 10 min calm→warn span
// and a 5 min warn→danger span, meeting at 15) — flag to Luke if that
// doesn't match his own mental model, it's a one-line change either way.
//
// This function alone is fully reversible — NDL recovering from 5 back up
// to 50 on ascent genuinely means the risk passed, and the colour should
// say so. It only answers "what colour does THIS ndl value deserve right
// now" and never reaches full deco darkness itself (that colour is reserved
// for the ONE-WAY "locked once genuinely in deco" state, a different,
// darker shade the caller — renderProfileChart — applies on top of this
// once the dive's history says it's happened; this function has no way to
// know that on its own).
function _ndlColor(ndlMin, calmHex, warnHex, dangerHex) {
  if (typeof ndlMin !== 'number') return calmHex;
  // Danger zone: <10 min = full danger
  if (ndlMin <= 5) return dangerHex;
  // Danger→Warning gradient: 10-15 min
  if (ndlMin <= 10) return _hexLerp(dangerHex, warnHex, (10 - ndlMin) / 5);
  // Warning zone: 15-25 min = solid warning
  if (ndlMin <= 20) return warnHex;
  // Warning→Calm gradient: 25-60 min (EXPANDED from 25-40)
  if (ndlMin <= 50) return _hexLerp(warnHex, calmHex, (50 - ndlMin) / 25);

  return calmHex;
}

// Catmull-Rom → cubic Bezier through every point (tension=1, the standard
// 1/6 control-point factor) — "smoothing" here means rounding the corners
// between real samples, never resampling/decimating them away (DECISIONS.md
// — "Smoothing is fixed"). Every input point still sits exactly on the path.
function _smoothPathD(pts) {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

// Round-number axis step (e.g. 5/10/15/20…) so gridlines land on sensible
// values regardless of a dive's actual depth/duration range.
function _niceStep(maxVal, targetCount) {
  const rough = Math.max(maxVal, 1) / targetCount;
  const steps = [1, 2, 5, 10, 15, 20, 25, 50, 100, 200];
  return steps.find(s => s >= rough) || Math.ceil(rough / 100) * 100;
}
