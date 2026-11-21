// Checks the app's own libmaplibre.so after near-names.gradle changed it (names and dots near the camera in native 3D,
// plugins/TrailMap/android/near-names.gradle): the 3 name shaders and the dot shader carry the change, and each of them,
// put together as MapLibre hands it to OpenGL (src/mln/shaders/gl/shader_program_gl.cpp: "#version 300 es", the
// defines, the vertex prelude, the shader), compiles with Khronos' reference GLSL compiler (glslangValidator, from the
// glslang-tools package) when it's there.
// node test/near-names.mjs <libmaplibre.so> [...more]
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NAMES_TO = "clamp(0.5+0.5*distance_ratio,0.0,(u_pitch_with_map||u_label_plane_matrix*vec4(1,2,4,1)==vec4(1,2,4,1))?4.0:1.25);";
const DOTS_TO = "min(u_camera_to_center_distance,1.25*gl_Position.w);}else{";
let failed = 0;
const check = (ok, what) => { console.log((ok ? "ok      " : "FAILED  ") + what); if (!ok) failed++; };
let glslang = true;
try { execFileSync("glslangValidator", ["--version"], { stdio: "ignore" }); } catch { glslang = false; }
if (!glslang) console.log("::notice title=Native 3D names check::glslangValidator isn't installed here, so the shaders were not compiled");
const dir = mkdtempSync(join(tmpdir(), "near-names-"));

for (const file of process.argv.slice(2)) {
  const bin = readFileSync(file);
  // Every whole C string holding a marker.
  const strings = (marker) => {
    const out = new Map();
    for (let i = bin.indexOf(marker); i >= 0; i = bin.indexOf(marker, i + 1)) {
      const a = bin.lastIndexOf(0, i) + 1, b = bin.indexOf(0, i);
      if (!out.has(a)) out.set(a, bin.toString("latin1", a, b));
    }
    return [...out.values()];
  };
  const name = file.split("/").slice(-2, -1)[0] || file;
  const prelude = strings("projectTileWithElevation(").filter((s) => s.startsWith("#ifdef GL_ES\nprecision highp float;"));
  const names = strings("perspective_ratio").filter((s) => s.includes("u_label_plane_matrix"));
  const dots = strings("u_scale_with_map").filter((s) => s.includes("gl_Position"));
  check(prelude.length === 1, `${name}: MapLibre's vertex prelude found`);
  check(names.length === 3 && names.every((s) => s.split(NAMES_TO).length === 2 && !/4\.0\);/.test(s)),
    `${name}: the 3 name shaders are changed (${names.length} found)`);
  check(dots.length === 1 && dots[0].includes(DOTS_TO), `${name}: the dot shader is changed (${dots.length} found)`);
  if (!glslang || prelude.length !== 1) continue;
  [...names, ...dots].forEach((body, n) => {
    const src = join(dir, `${name}-${n}.vert`);
    writeFileSync(src, "#version 300 es\n#define DEVICE_PIXEL_RATIO 2.0\n" + prelude[0] + body, "latin1");
    let said = "";
    try { execFileSync("glslangValidator", ["-S", "vert", src], { encoding: "utf8" }); } catch (e) { said = String(e.stdout || e.message).slice(-600); }
    check(said === "", `${name}: ${n < names.length ? "name shader " + (n + 1) : "dot shader"} compiles as OpenGL ES 3.0 ${said}`);
  });
}
console.log(failed ? `${failed} native 3D names checks FAILED` : "All native 3D names checks passed");
process.exit(failed ? 1 : 0);
