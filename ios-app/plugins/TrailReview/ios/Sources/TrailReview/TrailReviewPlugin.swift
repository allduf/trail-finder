import Capacitor
import StoreKit
import UIKit

// Apple's own "Enjoying Trail Finder?" rating card (alex 2026-11-19: ask for a rating at a happy moment).
// rate.js on the website decides when (after a saved ride, tour, trip line, catch...) and calls requestReview().
// iOS decides whether the card really shows: at most 3 times a year, never in TestFlight, always in a development build.
// It never says whether it showed or what was given.
@objc(TrailReviewPlugin)
public class TrailReviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TrailReviewPlugin"
    public let jsName = "TrailReview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise)
    ]

    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let scene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }
            guard let scene = scene else { call.resolve(["asked": false]); return }
            if #available(iOS 16.0, *) {
                AppStore.requestReview(in: scene)
            } else {
                SKStoreReviewController.requestReview(in: scene)
            }
            call.resolve(["asked": true])
        }
    }
}
