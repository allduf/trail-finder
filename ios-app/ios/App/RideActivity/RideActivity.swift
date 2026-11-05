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
        // Directions (go-there.js): the next turn, metres to it (-1: none), its arrow, km left, arrival (s since 1970, 0: none)
        var turn: String
        var turnM: Int
        var arrow: String
        var leftKm: Double
        var eta: Double
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
    case "drive": return "🚗"
    case "walk": return "🚶"
    default: return "🚵"
    }
}

private func kmText(_ km: Double) -> String { String(format: km < 100 ? "%.2f" : "%.0f", km) }

// Directions: the turn's arrow (SF Symbols) and how far, like Google Maps on the lock screen.
private func symbol(_ a: String) -> String {
    switch a {
    case "right", "sharp-right": return "arrow.turn.up.right"
    case "left", "sharp-left": return "arrow.turn.up.left"
    case "slight-right": return "arrow.up.right"
    case "slight-left": return "arrow.up.left"
    case "uturn": return "arrow.uturn.down"
    case "roundabout": return "arrow.triangle.turn.up.right.circle"
    case "arrive": return "mappin.circle.fill"
    case "ferry": return "ferry"
    default: return "arrow.up"
    }
}

private func distText(_ m: Int) -> String {
    if m < 0 { return "" }
    if m < 100 { return "\(max(10, Int((Double(m) / 10).rounded()) * 10)) m" }
    if m < 1000 { return "\(Int((Double(m) / 50).rounded()) * 50) m" }
    return String(format: m < 9950 ? "%.1f km" : "%.0f km", Double(m) / 1000)
}

private struct TripLine: View {
    let ctx: ActivityViewContext<RideAttributes>
    var body: some View {
        HStack(spacing: 4) {
            Text("\(kmText(ctx.state.leftKm)) km left")
            if ctx.state.eta > 0 {
                Text("· arrive")
                Text(Date(timeIntervalSince1970: ctx.state.eta), style: .time)
            }
        }
        .font(.footnote.weight(.semibold)).monospacedDigit().foregroundColor(.white.opacity(0.85)).lineLimit(1)
    }
}

// The lock screen while following directions: the arrow, how far, the words, then the km left and the arrival time.
private struct TurnView: View {
    let ctx: ActivityViewContext<RideAttributes>
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: symbol(ctx.state.arrow)).font(.system(size: 36, weight: .bold)).foregroundColor(lime).frame(width: 46)
                VStack(alignment: .leading, spacing: 1) {
                    if ctx.state.turnM >= 0 && ctx.state.arrow != "arrive" {
                        Text(distText(ctx.state.turnM)).font(.system(size: 28, weight: .heavy, design: .rounded)).monospacedDigit()
                    }
                    Text(ctx.state.turn).font(.subheadline.weight(.semibold)).lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            HStack {
                TripLine(ctx: ctx)
                Spacer()
                Text("Trail Finder").font(.caption2).foregroundColor(.white.opacity(0.6))
            }
        }
    }
}

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
            Group {
            if !ctx.state.turn.isEmpty {
                TurnView(ctx: ctx)
            } else {
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
            }
            }
            .padding(14)
            .foregroundColor(.white)
            .activityBackgroundTint(Color(red: 0.07, green: 0.16, blue: 0.12).opacity(0.92))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    if !ctx.state.turn.isEmpty {
                        HStack(spacing: 6) {
                            Image(systemName: symbol(ctx.state.arrow)).font(.title2.weight(.bold)).foregroundColor(lime)
                            Text(distText(ctx.state.turnM)).font(.title3.weight(.heavy)).monospacedDigit()
                        }
                    } else {
                        HStack(spacing: 4) {
                            Text(icon(ctx.attributes.sport))
                            Clock(ctx: ctx).font(.title3.weight(.heavy)).monospacedDigit().foregroundColor(lime)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if !ctx.state.turn.isEmpty {
                        if ctx.state.eta > 0 {
                            Text(Date(timeIntervalSince1970: ctx.state.eta), style: .time).font(.title3.weight(.bold)).monospacedDigit()
                        }
                    } else {
                        Text("\(kmText(ctx.state.km)) km · \(ctx.state.climb) m").font(.title3.weight(.bold)).monospacedDigit()
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !ctx.state.turn.isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ctx.state.turn).font(.subheadline.weight(.semibold)).lineLimit(2)
                            TripLine(ctx: ctx)
                        }
                    } else if !ctx.state.line.isEmpty { Text(ctx.state.line).font(.footnote).lineLimit(1) }
                }
            } compactLeading: {
                if !ctx.state.turn.isEmpty {
                    Image(systemName: symbol(ctx.state.arrow)).foregroundColor(lime)
                } else {
                    Text(icon(ctx.attributes.sport))
                }
            } compactTrailing: {
                if !ctx.state.turn.isEmpty {
                    Text(distText(ctx.state.turnM)).monospacedDigit().foregroundColor(lime)
                } else {
                    Text("\(kmText(ctx.state.km)) km").monospacedDigit().foregroundColor(lime)
                }
            } minimal: {
                if !ctx.state.turn.isEmpty {
                    Image(systemName: symbol(ctx.state.arrow)).foregroundColor(lime)
                } else {
                    Text(icon(ctx.attributes.sport))
                }
            }
        }
    }
}
