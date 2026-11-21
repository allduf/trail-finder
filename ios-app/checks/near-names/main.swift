// Checks NativeNearNames.swift (names and dots near the camera in native 3D) on a Mac, in the iPhone app workflow's
// build check, against the MapLibre Native the app is built with:
//   1. every name and dot shader in MapLibre's binary still reads as NativeNearNames expects (so a MapLibre update that
//      changes them shows up here, not as big names on phones), and no other text is changed;
//   2. the hook itself, on a stand-in compiler: the changed text goes in; MapLibre's own goes in again when the changed
//      text fails or only warns; a real failure still reports its error; every library is released exactly once;
//   3. when the Mac has a Metal device: MapLibre's own lines, changed, compile and give the right sizes.
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

// 1. MapLibre's own text ----------------------------------------------------------------------------------------------
guard CommandLine.arguments.count > 1, let bin = FileManager.default.contents(atPath: CommandLine.arguments[1]) else {
    print("FAILED  no MapLibre binary (near-names <path to MapLibre.framework/MapLibre>)")
    exit(1)
}
// The whole C strings around each place a marker is found (MapLibre keeps each shader's text as one).
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
var nameLine: String?, dotLine: String?, names = 0, dots = 0, others = 0
for text in Set(cStrings(with: "perspective_ratio") + cStrings(with: "scale_with_map")).sorted() {
    let out = NativeNearNames.changed(text as NSString)
    if text.contains("float perspective_ratio") {
        names += 1
        check(out?.contains("? 4.0 : \(NativeNearNames.nearMax))") == true && out?.contains("4.0);") == false,
              "MapLibre's name shader \(names) is changed")
        nameLine = nameLine ?? statement(text, from: "const float perspective_ratio")
    } else if text.contains("props.scale_with_map") {
        dots += 1
        check(out?.contains("\(NativeNearNames.nearMax) * position.w") == true, "MapLibre's dot shader is changed")
        dotLine = dotLine ?? statement(text, from: "const float factor")
    } else {
        others += 1
        check(out == nil, "other MapLibre text is left alone: " + (text.split(separator: "\n").first.map(String.init) ?? "").prefix(60))
    }
}
check(names == 3, "MapLibre's 3 name shaders found (\(names))")
check(dots == 1, "MapLibre's dot shader found (\(dots))")
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
        let changed = text.contains(" : \(NativeNearNames.nearMax)")
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
func compile(_ target: AnyObject, _ text: String) -> (lib: UnsafeMutableRawPointer?, error: UnsafeMutableRawPointer?) {
    guard let imp = class_getMethodImplementation(object_getClass(target), sel) else { return (nil, nil) }
    let send = unsafeBitCast(imp, to: NativeNearNames.Compile.self)
    var error: UnsafeMutableRawPointer?
    let lib = withUnsafeMutablePointer(to: &error) { send(target, sel, text as NSString, nil, UnsafeMutableRawPointer($0)) }
    return (lib, error)
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

// 3. Metal: MapLibre's own lines, changed, compile and give the right sizes -----------------------------------------
let device = MTLCreateSystemDefaultDevice() ?? MTLCopyAllDevices().first
if let device = device, let nameLine = nameLine, let dotLine = dotLine, let queue = device.makeCommandQueue() {
    print("Metal device: \(device.name)")
    let options = MTLCompileOptions()
    options.languageVersion = .version2_4      // as MapLibre (mtl/context.cpp)
    if #available(macOS 15.0, *) { options.mathMode = .fast } else { options.fastMathEnabled = true }
    // MapLibre's names for what the lines use; the rest is only what the check needs.
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
    // Inputs: a name's label plane matrix (identity, or one with perspective as MapLibre's for upright names), flat on
    // the ground or not, and how much nearer than the middle of the view; a dot's w with the middle at 1000.
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
        check(near(capped.0, nameCapped), "changed: upright names at most \(NativeNearNames.nearMax) times, flat ones and identity planes keep 4, far ones unchanged \(capped.0)")
        check(near(capped.1, dotCapped), "changed: upright dots at most \(NativeNearNames.nearMax) times, far ones unchanged \(capped.1)")
        // A changed text that doesn't compile (no label plane matrix here): MapLibre's own is compiled instead.
        let fallback = try run(sizes("label_plane"), "sizes", [drawables], count: nameCases.count)
        check(near(fallback, nameOwn), "changed text that fails: MapLibre's own compiled instead \(fallback)")
    } catch {
        check(false, "Metal: \(error)")
    }
    var broken = false
    do { _ = try device.makeLibrary(source: sizes("label_plane_matrix") + "\nnot metal", options: options) } catch { broken = true }
    check(broken, "a text that fails either way still reports its error")
} else {
    print("::notice title=Native 3D names check::No Metal device on this Mac: the compile and size part was skipped")
}

print(failures == 0 ? "All native 3D names checks passed" : "\(failures) native 3D names checks FAILED")
exit(failures == 0 ? 0 : 1)
