import Foundation
import Metal
import ObjectiveC

// Names and dots close to the camera stay near their normal size in native 3D, as in the web 3D map (map3d.js, PR #885;
// alex's recording 2026-11-21 at Wedge Mountain: near the bottom of a tilted view, names were about 3 times their size
// and one ran off the screen). MapLibre draws an upright name bigger the nearer it is than the middle of the view, up to
// 4 times (perspective_ratio in its symbol shaders), and an upright dot that scales with the map with no limit (its
// circle shader). No style property changes either.
// MapLibre Native compiles its Metal shaders from their text when a map first draws (newLibraryWithSource:options:error:
// on the system's Metal device, in its mtl/context.cpp), so this changes that text on its way to the compiler:
//   - an upright name or picture (peaks, places, water, pins and their names, Tools' labels) grows at most NEAR_MAX times
//     near the camera; farther ones still get smaller, so distance still reads. Names lying flat on the ground
//     (pitch_with_map) keep MapLibre's 4 times, and so do names along a line or with variable anchors: MapLibre places
//     those on the processor at the full size (their label plane matrix is then the identity), so a smaller one would
//     drift away from its spot. No native layer uses variable anchors today (the web map moves them back, map3d.js).
//   - an upright dot scaled with the map (Tools' dots, Fishing's spot) stops at NEAR_MAX times too, so a name under it
//     stays clear of it.
// MapLibre still keeps the room a near name would take at full size free of other names (its collision boxes are worked
// out on the processor), as on the web.
// Safety: text that reads differently (another MapLibre) is left as it is, and changed text that doesn't compile cleanly
// (an error, or a warning, which MapLibre also counts as a failure) is compiled again as MapLibre's own. Either way names
// and dots draw as before, with one line in the device log. ios-app/checks/near-names.swift checks all this on a Mac in
// the iPhone app workflow: the real MapLibre text still matches, the change compiles, and the sizes come out right.
enum NativeNearNames {
    static let nearMax = "1.25"   // NEAR_MAX in map3d.js

    // MapLibre's symbol shaders (icon, text, text and icon): the clamp at 4, however its spaces and comment are written.
    private static let size = try! NSRegularExpression(pattern:
        #"\bperspective_ratio\s*=\s*clamp\(\s*0\.5\s*\+\s*0\.5\s*\*\s*distance_ratio\s*,\s*0\.0\s*,\s*(?://[^\n]*\n\s*)?4\.0\s*\)"#)
    // A label plane matrix that leaves a point where it is: MapLibre's identity (names along a line, variable anchors).
    private static let sizeTo = "perspective_ratio = clamp(0.5 + 0.5 * distance_ratio, 0.0, (drawable.pitch_with_map || " +
        "all(drawable.label_plane_matrix * float4(1.0, 2.0, 4.0, 1.0) == float4(1.0, 2.0, 4.0, 1.0))) ? 4.0 : \(nearMax))"
    // MapLibre's circle shader: an upright dot's size on the screen is camera_to_center_distance / w times its size in the
    // middle of the view.
    private static let dot = try! NSRegularExpression(pattern:
        #"\bfactor\s*=\s*props\.scale_with_map\s*\?\s*paintParams\.camera_to_center_distance\s*:\s*position\.w\s*;"#)
    private static let dotTo = "factor = props.scale_with_map ? min(float(paintParams.camera_to_center_distance), " +
        "\(nearMax) * position.w) : position.w;"

    // The shader text with the change made, or nil when there's nothing to change (most shaders) or it reads differently.
    static func changed(_ text: NSString) -> String? {
        if text.range(of: "float perspective_ratio").location != NSNotFound {
            return apply(size, sizeTo, text, "MapLibre's name shaders read differently")
        }
        if text.range(of: "props.scale_with_map").location != NSNotFound {
            return apply(dot, dotTo, text, "MapLibre's dot shader reads differently")
        }
        return nil
    }

    private static func apply(_ re: NSRegularExpression, _ to: String, _ text: NSString, _ why: String) -> String? {
        let s = text as String, all = NSRange(location: 0, length: text.length)
        guard re.numberOfMatches(in: s, range: all) == 1 else { say(why); return nil }
        return re.stringByReplacingMatches(in: s, range: all, withTemplate: NSRegularExpression.escapedTemplate(for: to))
    }

    // Once, before the first native map is made (TrailMapScreen's init). MapLibre gets the same device
    // (MTL::CreateSystemDefaultDevice in its mtl/renderer_backend.cpp), so the change goes on that device's class.
    static func install() {
        lock.lock()
        let first = !installed
        installed = true
        lock.unlock()
        guard first else { return }
        guard let device = MTLCreateSystemDefaultDevice(), let cls = object_getClass(device) else { say("no Metal device"); return }
        if !hook(cls) { say("no shader compiler to change") }
    }

    // newLibraryWithSource:options:error: as MapLibre calls it: the library comes back retained ("new"), the error is
    // only written on a problem. Pointers, so Swift adds no retains or releases of its own to the library or the error.
    typealias Compile = @convention(c) (AnyObject, Selector, AnyObject?, AnyObject?, UnsafeMutableRawPointer?) -> UnsafeMutableRawPointer?

    // Puts the change in front of cls's compiler (also used by the checker).
    @discardableResult
    static func hook(_ cls: AnyClass) -> Bool {
        let sel = NSSelectorFromString("newLibraryWithSource:options:error:")
        guard let method = class_getInstanceMethod(cls, sel), let types = method_getTypeEncoding(method) else { return false }
        let own = unsafeBitCast(method_getImplementation(method), to: Compile.self)
        let block: @convention(block) (AnyObject, AnyObject?, AnyObject?, UnsafeMutableRawPointer?) -> UnsafeMutableRawPointer? = {
            device, source, options, error in
            guard let text = source as? NSString, let next = changed(text) else { return own(device, sel, source, options, error) }
            var problem: UnsafeMutableRawPointer?
            let lib = withUnsafeMutablePointer(to: &problem) { own(device, sel, next as NSString, options, UnsafeMutableRawPointer($0)) }
            if let lib = lib, problem == nil { return lib }
            // Compiled with a warning (MapLibre would refuse it) or not at all: MapLibre's own text instead.
            if let lib = lib { Unmanaged<AnyObject>.fromOpaque(lib).release() }
            let detail = problem.map { ": " + String(Unmanaged<NSError>.fromOpaque($0).takeUnretainedValue().localizedDescription.prefix(300)) } ?? ""
            say("the changed shaders didn't compile on this device" + detail)
            return own(device, sel, source, options, error)
        }
        let imp = imp_implementationWithBlock(block)
        // The method can come from a parent class: then it's added to this one, and the parent's is still called.
        if !class_addMethod(cls, sel, imp, types) { method_setImplementation(method, imp) }
        return true
    }

    private static let lock = NSLock()
    private static var installed = false
    private static var said = Set<String>()
    private static func say(_ why: String) {
        lock.lock()
        let first = said.insert(why).inserted
        lock.unlock()
        if first { NSLog("TrailMap 3D: %@; names and dots near the camera grow as before", why) }
    }
}
