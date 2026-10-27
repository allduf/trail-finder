import ActivityKit
import SwiftUI
import WidgetKit

// The ride on the lock screen and in the Dynamic Island while Trail Finder records (a Live Activity).
// TrailGps (ios-app/plugins/TrailGps) starts, updates and ends it; RideAttributes must stay the same as the copy there.
// The clock counts by itself from the start; km, climb and the line under them come from the app, also with the
// phone locked (the app's GPS adds up the km and climb itself then).
struct RideAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var km: Double
        var climb: Int
        var line: String
        var paused: Bool
        var pausedText: String
    }
    var sport: String
    var title: String
    var start: Date
}

@main
struct RideActivityBundle: WidgetBundle {
    var body: some Widget {
        RideActivityWidget()
    }
}

private let lime = Color(red: 0.78, green: 0.94, blue: 0.38)

private func icon(_ sport: String) -> String {
    switch sport {
    case "ski": return "⛷"
    case "hunt": return "🦌"
    case "fish": return "🎣"
    case "moto": return "🏍"
    default: return "🚵"
    }
}

private func kmText(_ km: Double) -> String { String(format: km < 100 ? "%.2f" : "%.0f", km) }

private struct Clock: View {
    let ctx: ActivityViewContext<RideAttributes>
    var body: some View {
        if ctx.state.paused {
            Text(ctx.state.pausedText.isEmpty ? "Paused" : ctx.state.pausedText)
        } else {
            Text(ctx.attributes.start, style: .timer)
        }
    }
}

private struct Stat: View {
    let value: String
    let unit: String
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.system(size: 22, weight: .heavy, design: .rounded)).monospacedDigit()
            Text(unit).font(.caption2).foregroundColor(.white.opacity(0.7))
        }
    }
}

struct RideActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RideAttributes.self) { ctx in
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(icon(ctx.attributes.sport))
                    Text(ctx.state.paused ? "Paused" : ctx.attributes.title).font(.subheadline.weight(.bold)).lineLimit(1)
                    Spacer()
                    Text("Trail Finder").font(.caption2).foregroundColor(.white.opacity(0.6))
                }
                HStack(alignment: .firstTextBaseline, spacing: 18) {
                    VStack(alignment: .leading, spacing: 0) {
                        Clock(ctx: ctx).font(.system(size: 30, weight: .heavy, design: .rounded)).monospacedDigit().foregroundColor(lime)
                            .frame(minWidth: 90, alignment: .leading)
                        Text("time").font(.caption2).foregroundColor(.white.opacity(0.7))
                    }
                    Stat(value: kmText(ctx.state.km), unit: "km")
                    Stat(value: "\(ctx.state.climb)", unit: "m climb")
                }
                if !ctx.state.line.isEmpty {
                    Text(ctx.state.line).font(.footnote).lineLimit(1).foregroundColor(.white.opacity(0.9))
                }
            }
            .padding(14)
            .foregroundColor(.white)
            .activityBackgroundTint(Color(red: 0.07, green: 0.16, blue: 0.12).opacity(0.92))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 4) {
                        Text(icon(ctx.attributes.sport))
                        Clock(ctx: ctx).font(.title3.weight(.heavy)).monospacedDigit().foregroundColor(lime)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("\(kmText(ctx.state.km)) km · \(ctx.state.climb) m").font(.title3.weight(.bold)).monospacedDigit()
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !ctx.state.line.isEmpty { Text(ctx.state.line).font(.footnote).lineLimit(1) }
                }
            } compactLeading: {
                Text(icon(ctx.attributes.sport))
            } compactTrailing: {
                Text("\(kmText(ctx.state.km)) km").monospacedDigit().foregroundColor(lime)
            } minimal: {
                Text(icon(ctx.attributes.sport))
            }
        }
    }
}
