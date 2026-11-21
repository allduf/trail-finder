// Checks NativeNearNames.swift (names and dots near the camera in native 3D) on a Mac, in the iPhone app workflow's
// build check, against the MapLibre Native the app is built with:
//   1. its shaders, put together as MapLibre hands them to the compiler (shared prelude + the shader's prelude + its
//      text, mtl/shader_group.hpp): the 3 name shaders and the dot shader still read as NativeNearNames expects and
//      still have the fields the change uses (so a MapLibre update that changes them shows up here, not as big names
//      on phones), and every other shader is left alone;
//   2. the hook itself, on a stand-in compiler: the changed text goes in; MapLibre's own goes in again when the changed
//      text fails or only warns; a real failure still reports its error; every library is released exactly once;
//   3. with a Metal device: MapLibre's whole name and dot shaders compile changed with no warning, and small kernels
//      made of MapLibre's own lines give the right sizes, through the hook too. Without one, the whole shaders are
//      compiled with Xcode's Metal compiler when it's there (warnings count as failures, as in MapLibre).
// swiftc NativeNearNames.swift checks/near-names/main.swift -o near-names && ./near-names <MapLibre binary>
import Foundation
import Metal
import ObjectiveC

var failures = 0
func check(_ ok: Bool, _ what: String) {
    print((ok ? "ok      " : "FAILED  ") + what)
    if !ok { failures += 1 }
}
func near(_ a: [Float], _ b: [Float]) -> Bool { a.count == b.count && zip(a, b).allSatisfy { abs($0 - $1) < 1e-4 } }
let cap = NativeNearNames.nearMax

// 1. MapLibre's own text ----------------------------------------------------------------------------------------------
guard CommandLine.arguments.count > 1, let bin = FileManager.default.contents(atPath: CommandLine.arguments[1]) else {
    print("FAILED  no MapLibre binary (near-names <path to MapLibre.framework/MapLibre>)")
    exit(1)
}
// The whole C strings around each place a marker is found (MapLibre keeps each piece of shader text as one).
func cStrings(with marker: String) -> [String] {
    var out: [String] = [], from = bin.startIndex
    let m = Data(marker.utf8)
    while let r = bin.range(of: m, in: from..<bin.endIndex) {
        var a = r.lowerBound, b = r.upperBound
        while a > bin.startIndex && bin[a - 1] != 0 { a -= 1 }
        while b < bin.endIndex && bin[b] != 0 { b += 1 }
        if let s = String(data: bin[a..<b], encoding: .utf8) { out.append(s) }
        from = b
    }
    return out
}
// From a line's start to its statement's end.
func statement(_ text: String, from start: String) -> String? {
    guard let a = text.range(of: start), let b = text.range(of: ";", range: a.upperBound..<text.endIndex) else { return nil }
    return String(text[a.lowerBound..<b.upperBound])
}
let shared = cStrings(with: "#include <metal_stdlib>").filter { $0.contains("GlobalPaintParamsUBO") }
let namePrelude = cStrings(with: "struct alignas(16) SymbolDrawableUBO")
let dotPrelude = cStrings(with: "struct alignas(16) CircleDrawableUBO")
check(shared.count == 1 && namePrelude.count == 1 && dotPrelude.count == 1,
      "MapLibre's shared prelude and its name and dot preludes found (\(shared.count), \(namePrelude.count), \(dotPrelude.count))")
let common = shared.first ?? ""
var nameShaders: [String] = [], dotShaders: [String] = [], others = 0
var nameLine: String?, dotLine: String?
for body in Set(cStrings(with: "vertexMain(")).sorted() {
    if body.contains("float perspective_ratio") {
        let whole = common + (namePrelude.first ?? "") + body
        nameShaders.append(whole)
        let out = NativeNearNames.changed(whole as NSString)
        check(out?.contains("? 4.0 : \(cap))") == true && out?.contains("4.0);") == false, "MapLibre's name shader \(nameShaders.count) is changed")
        check(body.contains("drawable.pitch_with_map") && body.contains("drawable.label_plane_matrix"),
              "MapLibre's name shader \(nameShaders.count) still has the fields the change uses")
        nameLine = nameLine ?? statement(body, from: "const float perspective_ratio")
    } else if body.contains("props.scale_with_map") {
        let whole = common + (dotPrelude.first ?? "") + body
        dotShaders.append(whole)
        check(NativeNearNames.changed(whole as NSString)?.contains("\(cap) * position.w") == true, "MapLibre's dot shader is changed")
        dotLine = dotLine ?? statement(body, from: "const float factor")
    } else if NativeNearNames.changed((common + body) as NSString) != nil {
        check(false, "another MapLibre shader would be changed: " + (body.split(separator: "\n").first.map(String.init) ?? ""))
    } else {
        others += 1
    }
}
check(nameShaders.count == 3, "MapLibre's 3 name shaders found (\(nameShaders.count))")
check(dotShaders.count == 1, "MapLibre's dot shader found (\(dotShaders.count))")
check(others >= 20, "MapLibre's \(others) other shaders are left alone")
check(nameLine != nil && dotLine != nil, "the lines to change found in them")

// 2. The hook, on a stand-in compiler --------------------------------------------------------------------------------
final class Probe: NSObject {
    static var live = 0
    override init() { Probe.live += 1; super.init() }
    deinit { Probe.live -= 1 }
}
final class StandIn: NSObject {
    enum Mode { case ok, warnChanged, failChanged, failAll }
    var mode = Mode.ok
    var got: [String] = []
    // Same name, so the same rules as Metal's: the library comes back retained, the error is autoreleased.
    @objc(newLibraryWithSource:options:error:)
    func newLibrary(_ source: NSString?, options: AnyObject?, error: UnsafeMutableRawPointer?) -> AnyObject? {
        let text = (source as String?) ?? ""
        got.append(text)
        let changed = text.contains(" : \(cap)")
        func problem(_ what: String) {
            let e = NSError(domain: "StandIn", code: 1, userInfo: [NSLocalizedDescriptionKey: what])
            error?.storeBytes(of: Unmanaged.passRetained(e).autorelease().toOpaque(), as: UnsafeMutableRawPointer.self)
        }
        switch mode {
        case .ok: return Probe()
        case .warnChanged: if changed { problem("stand-in warning") }; return Probe()
        case .failChanged: if changed { problem("stand-in error"); return nil }; return Probe()
        case .failAll: problem("stand-in error"); return nil
        }
    }
}
let sel = NSSelectorFromString("newLibraryWithSource:options:error:")
// As MapLibre calls it (metal-cpp: a plain message, the library taken over as it comes, the error read after).
func compile(_ target: AnyObject, _ text: String, _ options: AnyObject? = nil) -> (lib: UnsafeMutableRawPointer?, error: String?) {
    guard let imp = class_getMethodImplementation(object_getClass(target), sel) else { return (nil, "no compiler") }
    let send = unsafeBitCast(imp, to: NativeNearNames.Compile.self)
    var error: UnsafeMutableRawPointer?
    let lib = withUnsafeMutablePointer(to: &error) { send(target, sel, text as NSString, options, UnsafeMutableRawPointer($0)) }
    return (lib, error.map { Unmanaged<NSError>.fromOpaque($0).takeUnretainedValue().localizedDescription })
}
let nameText = "const float distance_ratio = 2.0;\n" + (nameLine ?? "const float perspective_ratio = clamp(\n    0.5 + 0.5 * distance_ratio,\n    0.0, // Prevents\n    4.0);")
let stand = StandIn()
check(NativeNearNames.hook(StandIn.self), "hook put in front of a stand-in compiler")
for (mode, text, calls, library, what) in [
    (StandIn.Mode.ok, "kernel void other() {}", 1, true, "another shader goes through as it is"),
    (.ok, nameText, 1, true, "a name shader goes in changed"),
    (.warnChanged, nameText, 2, true, "changed text with a warning: MapLibre's own goes in again, no error reported"),
    (.failChanged, nameText, 2, true, "changed text that fails: MapLibre's own goes in again, no error reported"),
    (.failAll, nameText, 2, false, "MapLibre's own text failing still reports its error")
] {
    var ok = true
    for _ in 0..<200 {
        autoreleasepool {
            stand.mode = mode
            stand.got = []
            let r = compile(stand, text)
            ok = ok && stand.got.count == calls && (r.lib != nil) == library && (r.error == nil) == library
            ok = ok && ((stand.got.first ?? text) != text) == (text == nameText)   // a name shader goes in changed first
            ok = ok && (calls == 1 || stand.got.last == text)                     // then MapLibre's own, as it was
            if let lib = r.lib { Unmanaged<AnyObject>.fromOpaque(lib).release() }
        }
    }
    check(ok && Probe.live == 0, what + " (200 times, \(Probe.live) libraries left over)")
}

// 3. Compiling: MapLibre's whole shaders, then the sizes ------------------------------------------------------------
let wholes = nameShaders.map { ("name", $0) } + dotShaders.map { ("dot", $0) }
let device = MTLCreateSystemDefaultDevice() ?? MTLCopyAllDevices().first
if let device = device, let nameLine = nameLine, let dotLine = dotLine, let queue = device.makeCommandQueue() {
    print("Metal device: \(device.name)")
    let options = MTLCompileOptions()          // as MapLibre (mtl/context.cpp), with the defines every shader gets
    options.languageVersion = .version2_4
    if #available(macOS 15.0, *) { options.mathMode = .fast } else { options.fastMathEnabled = true }
    options.preprocessorMacros = ["DEVICE_PIXEL_RATIO": "3.0" as NSString]
    // Not through the hook yet: a warning shows here as it would to MapLibre.
    for (n, (kind, whole)) in wholes.enumerated() {
        autoreleasepool {
            let own = compile(device, whole, options)
            if let lib = own.lib { Unmanaged<AnyObject>.fromOpaque(lib).release() }
            guard own.lib != nil && own.error == nil else {
                print("::warning title=Native 3D names check::MapLibre's own \(kind) shader \(n + 1) doesn't compile cleanly on this Mac, so its changed one can't be judged: \(own.error ?? "")")
                return
            }
            let changed = compile(device, NativeNearNames.changed(whole as NSString) ?? whole, options)
            if let lib = changed.lib { Unmanaged<AnyObject>.fromOpaque(lib).release() }
            check(changed.lib != nil && changed.error == nil, "MapLibre's whole \(kind) shader \(n + 1), changed, compiles with no warning \(changed.error ?? "")")
        }
    }
    // MapLibre's names for what its lines use; the rest is only what the check needs.
    let sizes = { (plane: String) in """
        #include <metal_stdlib>
        using namespace metal;
        struct SymbolDrawableUBO {
            float4x4 matrix;
            float4x4 \(plane);
            float4x4 coord_matrix;
            /*bool*/ int pitch_with_map;
            float distance_ratio;
            float pad0;
            float pad1;
        };
        kernel void sizes(device const SymbolDrawableUBO* drawableVector [[buffer(0)]], device float* out [[buffer(1)]],
                          uint i [[thread_position_in_grid]]) {
            device const SymbolDrawableUBO& drawable = drawableVector[i];
            const float distance_ratio = drawable.distance_ratio;
            \(nameLine)
            out[i] = perspective_ratio;
        }
        """ }
    let dotsText = """
        #include <metal_stdlib>
        using namespace metal;
        struct GlobalPaintParamsUBO { float camera_to_center_distance; float pad0; float pad1; float pad2; };
        struct CircleEvaluatedPropsUBO { int scale_with_map; float w; };
        kernel void dots(device const GlobalPaintParamsUBO& paintParams [[buffer(0)]],
                         device const CircleEvaluatedPropsUBO* propsVector [[buffer(1)]], device float* out [[buffer(2)]],
                         uint i [[thread_position_in_grid]]) {
            device const CircleEvaluatedPropsUBO& props = propsVector[i];
            float4 position = float4(0.0, 0.0, 0.0, props.w);
            \(dotLine)
            out[i] = factor;
        }
        """
    // Inputs: a name's label plane matrix (the identity, or one with perspective as MapLibre's for upright names), flat
    // on the ground or not, and how much nearer than the middle of the view; a dot's w with the middle at 1000.
    let identity: [Float] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    let upright: [Float] = [600, 0, 0, 0.3, 0, -600, 0, 0.4, 0, 0, 1, 0.1, 200, 300, 0, 800]
    let nameCases: [([Float], Int32, Float)] = [(upright, 0, 7), (identity, 0, 7), (upright, 1, 7), (upright, 0, 0.5), (upright, 0, 1.2), (upright, 0, 9)]
    let dotCases: [(Int32, Float)] = [(1, 200), (1, 2000), (0, 200), (1, 900)]
    func run(_ text: String, _ kernel: String, _ buffers: [[UInt8]], count: Int) throws -> [Float] {
        let lib = try device.makeLibrary(source: text, options: options)
        guard let fn = lib.makeFunction(name: kernel) else { throw NSError(domain: "check", code: 1) }
        let pipeline = try device.makeComputePipelineState(function: fn)
        guard let out = device.makeBuffer(length: count * 4, options: .storageModeShared),
              let cb = queue.makeCommandBuffer(), let enc = cb.makeComputeCommandEncoder() else { throw NSError(domain: "check", code: 2) }
        enc.setComputePipelineState(pipeline)
        for (i, b) in buffers.enumerated() { enc.setBuffer(device.makeBuffer(bytes: b, length: b.count, options: .storageModeShared), offset: 0, index: i) }
        enc.setBuffer(out, offset: 0, index: buffers.count)
        enc.dispatchThreadgroups(MTLSize(width: count, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: 1, height: 1, depth: 1))
        enc.endEncoding()
        cb.commit()
        cb.waitUntilCompleted()
        if let e = cb.error { throw e }
        return Array(UnsafeBufferPointer(start: out.contents().bindMemory(to: Float.self, capacity: count), count: count))
    }
    var drawables = [UInt8](repeating: 0, count: 208 * nameCases.count)
    drawables.withUnsafeMutableBytes { p in
        for (n, c) in nameCases.enumerated() {
            let at = n * 208
            for k in 0..<16 {
                p.storeBytes(of: identity[k], toByteOffset: at + k * 4, as: Float.self)
                p.storeBytes(of: c.0[k], toByteOffset: at + 64 + k * 4, as: Float.self)
                p.storeBytes(of: identity[k], toByteOffset: at + 128 + k * 4, as: Float.self)
            }
            p.storeBytes(of: c.1, toByteOffset: at + 192, as: Int32.self)
            p.storeBytes(of: c.2, toByteOffset: at + 196, as: Float.self)
        }
    }
    var paint = [UInt8](repeating: 0, count: 16), props = [UInt8](repeating: 0, count: 8 * dotCases.count)
    paint.withUnsafeMutableBytes { $0.storeBytes(of: Float(1000), as: Float.self) }
    props.withUnsafeMutableBytes { p in
        for (n, c) in dotCases.enumerated() {
            p.storeBytes(of: c.0, toByteOffset: n * 8, as: Int32.self)
            p.storeBytes(of: c.1, toByteOffset: n * 8 + 4, as: Float.self)
        }
    }
    let nameOwn: [Float] = [4, 4, 4, 0.75, 1.1, 4], nameCapped: [Float] = [1.25, 4, 4, 0.75, 1.1, 1.25]
    let dotOwn: [Float] = [1000, 1000, 200, 1000], dotCapped: [Float] = [250, 1000, 200, 1000]
    do {
        // MapLibre's own first (the hook isn't on the device yet): the inputs do reach the 4 times and the endless dot.
        let own = (try run(sizes("label_plane_matrix"), "sizes", [drawables], count: nameCases.count),
                   try run(dotsText, "dots", [paint, props], count: dotCases.count))
        check(near(own.0, nameOwn) && near(own.1, dotOwn), "MapLibre's own lines: names up to 4 times, dots without limit \(own)")
        check(NativeNearNames.hook(object_getClass(device)!), "hook put in front of the Metal device's compiler")
        let capped = (try run(sizes("label_plane_matrix"), "sizes", [drawables], count: nameCases.count),
                      try run(dotsText, "dots", [paint, props], count: dotCases.count))
        check(near(capped.0, nameCapped), "through the hook: upright names at most \(cap) times, flat ones and identity planes keep 4, far ones unchanged \(capped.0)")
        check(near(capped.1, dotCapped), "through the hook: upright dots at most \(cap) times, far ones unchanged \(capped.1)")
        // A changed text that doesn't compile (no label plane matrix here): MapLibre's own is compiled instead.
        let fallback = try run(sizes("label_plane"), "sizes", [drawables], count: nameCases.count)
        check(near(fallback, nameOwn), "through the hook, changed text that fails: MapLibre's own compiled instead \(fallback)")
    } catch {
        check(false, "Metal: \(error)")
    }
    var broken = false
    do { _ = try device.makeLibrary(source: sizes("label_plane_matrix") + "\nnot metal", options: options) } catch { broken = true }
    check(broken, "through the hook, a text that fails either way still reports its error")
} else {
    // No Metal device (Intel Macs in the cloud): Xcode's Metal compiler, if this Xcode has it, with warnings as errors.
    func metal(_ text: String) -> (ok: Bool, said: String) {
        let src = FileManager.default.temporaryDirectory.appendingPathComponent("near-names-\(UUID().uuidString).metal")
        do { try text.write(to: src, atomically: true, encoding: .utf8) } catch { return (false, "\(error)") }
        let p = Process(), pipe = Pipe()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        p.arguments = ["-sdk", "iphoneos", "metal", "-std=ios-metal2.4", "-ffast-math", "-DDEVICE_PIXEL_RATIO=3.0", "-Werror",
                       "-c", src.path, "-o", src.path + ".air"]
        p.standardOutput = pipe
        p.standardError = pipe
        do { try p.run() } catch { return (false, "\(error)") }
        let said = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        p.waitUntilExit()
        return (p.terminationStatus == 0, said)
    }
    let trial = metal("#include <metal_stdlib>\nusing namespace metal;\nkernel void k(device float* o [[buffer(0)]]) { o[0] = 1.0; }\n")
    if trial.ok {
        print("No Metal device: compiling with Xcode's Metal compiler instead")
        for (n, (kind, whole)) in wholes.enumerated() {
            let own = metal(whole)
            guard own.ok else {
                print("::warning title=Native 3D names check::MapLibre's own \(kind) shader \(n + 1) doesn't compile cleanly here, so its changed one can't be judged: \(own.said.prefix(500))")
                continue
            }
            let changed = metal(NativeNearNames.changed(whole as NSString) ?? whole)
            check(changed.ok, "MapLibre's whole \(kind) shader \(n + 1), changed, compiles with no warning \(changed.said.prefix(500))")
        }
    } else {
        print("::notice title=Native 3D names check::No Metal device and no Metal compiler on this Mac, so the compile and size part was skipped: \(trial.said.prefix(300))")
    }
}

print(failures == 0 ? "All native 3D names checks passed" : "\(failures) native 3D names checks FAILED")
exit(failures == 0 ? 0 : 1)
