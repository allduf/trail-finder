import UIKit
import Capacitor
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = TFBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

// The app's screen: Capacitor's, with a web view that can let touches through to a native map under it (alex
// 2026-11-22: one interface for 2D and 3D). Native 3D (plugins/TrailMap, TrailMapScreen.under) sits behind the page's
// drawing, the page turns see-through where its map was, and a touch where the page shows nothing of its own (the
// screen's pointInside says so, from the page's grid) goes to the map. Without a map under it, nothing changes.
class TFBridgeViewController: CAPBridgeViewController {
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        TFWebView(frame: frame, configuration: configuration)
    }
}

final class TFWebView: WKWebView {
    @objc weak var tfUnderlay: UIView?
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if let u = tfUnderlay, u.superview === self, !u.isHidden, u.alpha > 0.01 {
            let p = convert(point, to: u)
            if u.point(inside: p, with: event), let v = u.hitTest(p, with: event) { return v }
        }
        return super.hitTest(point, with: event)
    }
}
