import CoreLocation
import Foundation
import MapLibre
import UIKit

// The avalanche card in native 3D (step 8 of the native 3D plan, alex 2026-11-20; avalanche-rules). The slope colours
// themselves come through NativeGround (the page's own paint(), lossless). This card goes with them: it shows, word for
// word, what the page's own avalanche card says (native-avalanche.js reads it), so it can never say anything else:
//   { on, title, day, warn: [..], bands: [{ r: rating, n: band, c: colour, t: text colour }], line, notes: [..],
//     words: { avy, more, tap } (the card's own words in the page's language) }
// Warnings (example, expired, an old copy, no forecast) always show in full, in red, above the ratings. The notes (what
// the colours and the darker shade mean, the treeline estimate) show when the card is tapped open, with "Full forecast",
// which goes back to the page's card. Nothing shows while the page sends on: false.
// days: [{ t, on }] are the page card's own day buttons: pressing one here sends "avyDay" { i } and the page presses its
// own button, so the colours, this card and the slope card change exactly as on the page.
// spot: a slope tapped beside every trail and pin (emptyTap sends "avyTap" { lat, lon }): the page's own This spot top
// and Avalanche danger part, row by row (native-avalanche.js spotRows), in a card at the bottom that scrolls. ✕ or any
// other tap closes it ("avySpot" { close }); "More about this spot" goes back to the page's This spot card there.
final class NativeAvalanche: NativeLayer {
    let key = "avy"
    private weak var screen: TrailMapScreen?
    private var info: [String: Any] = ["on": false]
    private var open = false
    private let box = UIView()
    private let stack = UIStackView()
    private let sheet = UIView()               // the slope card, at the bottom
    private let sheetScroll = UIScrollView()
    private let sheetStack = UIStackView()
    private let sheetTitle = UILabel()
    private var spotAt: (Double, Double)?
    private var taps = 0, asked = 0           // the slope card asked for last (0: none): an older one arriving late stays shut
    private var links: [String] = []
    private var underKeys = false            // placed under the ground keys (NativeGround), once they're on the screen
    private func word(_ k: String, _ english: String) -> String {
        let w = (info["words"] as? [String: String])?[k] ?? ""
        return w.isEmpty ? english : w
    }

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        self.screen = screen
        show()
        screen.onEvent?("avyReady", [:])   // this build shows the card: the page may send the colours (native-avalanche.js)
    }

    func setData(_ json: String, style: MLNStyle?) {
        info = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? ["on": false]
        show()
        showSpot()
    }

    // A new tap anywhere closes the slope card; a tap beside every trail and pin, while the avalanche card shows, asks
    // the page for that slope's card.
    func tapBegan(screen: TrailMapScreen) {
        guard asked != 0 || !sheet.isHidden else { return }
        spotAt = nil
        asked = 0
        sheet.isHidden = true
        screen.send("avySpot", ["close": true])
    }
    func emptyTap(_ at: CLLocationCoordinate2D, screen: TrailMapScreen) -> Bool {
        guard (info["on"] as? Bool) == true else { return false }
        taps += 1
        asked = taps
        screen.send("avyTap", ["lat": at.latitude, "lon": at.longitude, "n": asked])
        return true
    }

    private func label(_ text: String, size: CGFloat, weight: UIFont.Weight, colour: UIColor) -> UILabel {
        let l = UILabel()
        l.text = text
        l.font = .systemFont(ofSize: size, weight: weight)
        l.textColor = colour
        l.numberOfLines = 0
        return l
    }

    private func show() {
        guard let screen = screen, screen.isViewLoaded else { return }
        if box.superview == nil {
            box.backgroundColor = UIColor.white.withAlphaComponent(0.96)
            box.layer.cornerRadius = 10
            box.layer.shadowColor = UIColor.black.cgColor
            box.layer.shadowOpacity = 0.2
            box.layer.shadowRadius = 4
            box.layer.shadowOffset = CGSize(width: 0, height: 1)
            box.translatesAutoresizingMaskIntoConstraints = false
            stack.axis = .vertical
            stack.spacing = 4
            stack.translatesAutoresizingMaskIntoConstraints = false
            box.addSubview(stack)
            box.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(toggle)))
            screen.view.addSubview(box)
            let g = screen.mapArea   // inside the map: clear of a tool's bar from the page (NativeTools.swift)
            NSLayoutConstraint.activate([
                stack.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 10),
                stack.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -10),
                stack.topAnchor.constraint(equalTo: box.topAnchor, constant: 8),
                stack.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -8),
                box.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 12),
                box.widthAnchor.constraint(lessThanOrEqualToConstant: 300),
                box.trailingAnchor.constraint(lessThanOrEqualTo: g.trailingAnchor, constant: -12),
                // Under the radar and smoke captions (NativeWeather.swift rows 0-1), and under the ground keys (sun and
                // shade can stay on with avalanche), never over them.
                box.topAnchor.constraint(greaterThanOrEqualTo: g.topAnchor, constant: 148)
            ])
            let pin = box.topAnchor.constraint(equalTo: g.topAnchor, constant: 148)
            pin.priority = .defaultLow
            pin.isActive = true
        }
        if !underKeys, let keys = NativeGround.current?.keyBox, keys.superview === screen.view {
            underKeys = true
            box.topAnchor.constraint(greaterThanOrEqualTo: keys.bottomAnchor, constant: 6).isActive = true
        }
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        guard (info["on"] as? Bool) == true else { box.isHidden = true; return }
        box.isHidden = false
        let ink = UIColor(red: 0.11, green: 0.14, blue: 0.2, alpha: 1)
        let title = (info["title"] as? String) ?? "", day = (info["day"] as? String) ?? ""
        let head = [word("avy", "Avalanche"), title, day].filter { !$0.isEmpty }.joined(separator: " · ")
        stack.addArrangedSubview(label(head, size: 13, weight: .bold, colour: ink))
        for w in (info["warn"] as? [String]) ?? [] where !w.isEmpty {
            let l = label(w, size: 11.5, weight: .semibold, colour: UIColor(red: 0.69, green: 0.07, blue: 0.1, alpha: 1))
            stack.addArrangedSubview(l)
        }
        let bands = (info["bands"] as? [[String: Any]]) ?? []
        if !bands.isEmpty {
            let row = UIStackView()
            row.axis = .horizontal
            row.spacing = 4
            row.distribution = .fillEqually
            for b in bands {
                let chip = UIView()
                chip.backgroundColor = NativeGround.colour((b["c"] as? String) ?? "") ?? .gray
                chip.layer.cornerRadius = 6
                let fg = NativeGround.colour((b["t"] as? String) ?? "") ?? ink
                let col = UIStackView(arrangedSubviews: [label((b["r"] as? String) ?? "", size: 11.5, weight: .bold, colour: fg),
                                                         label((b["n"] as? String) ?? "", size: 10, weight: .medium, colour: fg)])
                col.axis = .vertical
                col.spacing = 0
                col.translatesAutoresizingMaskIntoConstraints = false
                chip.addSubview(col)
                NSLayoutConstraint.activate([
                    col.leadingAnchor.constraint(equalTo: chip.leadingAnchor, constant: 6),
                    col.trailingAnchor.constraint(equalTo: chip.trailingAnchor, constant: -6),
                    col.topAnchor.constraint(equalTo: chip.topAnchor, constant: 4),
                    col.bottomAnchor.constraint(equalTo: chip.bottomAnchor, constant: -4)
                ])
                row.addArrangedSubview(chip)
            }
            stack.addArrangedSubview(row)
        }
        let days = (info["days"] as? [[String: Any]]) ?? []
        if days.count > 1 {
            let row = UIStackView()
            row.axis = .horizontal
            row.spacing = 4
            row.distribution = .fillEqually
            for (i, d) in days.enumerated() {
                let on = (d["on"] as? Bool) == true
                let b = UIButton(type: .custom)
                b.setTitle((d["t"] as? String) ?? "", for: .normal)
                b.titleLabel?.font = .systemFont(ofSize: 11.5, weight: .semibold)
                b.titleLabel?.adjustsFontSizeToFitWidth = true
                b.titleLabel?.minimumScaleFactor = 0.75
                b.setTitleColor(on ? .white : ink, for: .normal)
                b.backgroundColor = on ? ink : .white
                b.layer.cornerRadius = 13
                b.layer.borderWidth = 1
                b.layer.borderColor = (on ? ink : UIColor(red: 0.8, green: 0.83, blue: 0.87, alpha: 1)).cgColor
                b.heightAnchor.constraint(equalToConstant: 26).isActive = true
                b.accessibilityTraits = on ? [.button, .selected] : .button
                b.tag = i
                b.addTarget(self, action: #selector(dayTapped(_:)), for: .touchUpInside)
                row.addArrangedSubview(b)
            }
            stack.addArrangedSubview(row)
        }
        let line = (info["line"] as? String) ?? ""
        if !line.isEmpty { stack.addArrangedSubview(label(line, size: 11.5, weight: .regular, colour: ink)) }
        if open {
            for n in (info["notes"] as? [String]) ?? [] where !n.isEmpty {
                stack.addArrangedSubview(label(n, size: 10.5, weight: .regular, colour: UIColor(red: 0.36, green: 0.4, blue: 0.46, alpha: 1)))
            }
            let more = UIButton(type: .system)
            more.setTitle(word("more", "Full forecast") + " ›", for: .normal)
            more.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
            more.contentHorizontalAlignment = .leading
            more.addTarget(self, action: #selector(full), for: .touchUpInside)
            stack.addArrangedSubview(more)
        } else if !((info["notes"] as? [String]) ?? []).isEmpty {
            stack.addArrangedSubview(label(word("tap", "Tap for what the colours mean"), size: 10.5, weight: .medium, colour: UIColor(red: 0.12, green: 0.37, blue: 0.88, alpha: 1)))
        }
    }

    // ---------- the slope card ----------
    private func buildSheet(in screen: TrailMapScreen) {
        sheet.backgroundColor = .white
        sheet.layer.cornerRadius = 16
        sheet.layer.shadowColor = UIColor.black.cgColor
        sheet.layer.shadowOpacity = 0.25
        sheet.layer.shadowRadius = 10
        sheet.layer.shadowOffset = CGSize(width: 0, height: 2)
        sheet.isHidden = true
        sheet.translatesAutoresizingMaskIntoConstraints = false
        sheetTitle.font = .systemFont(ofSize: 17, weight: .bold)
        sheetTitle.textColor = UIColor(red: 0.11, green: 0.14, blue: 0.2, alpha: 1)
        sheetTitle.translatesAutoresizingMaskIntoConstraints = false
        let shut = UIButton(type: .system)
        shut.setTitle("✕", for: .normal)
        shut.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        shut.tintColor = sheetTitle.textColor
        shut.addTarget(self, action: #selector(closeSpot), for: .touchUpInside)
        shut.translatesAutoresizingMaskIntoConstraints = false
        sheetScroll.translatesAutoresizingMaskIntoConstraints = false
        sheetScroll.alwaysBounceVertical = false
        sheetStack.axis = .vertical
        sheetStack.spacing = 6
        sheetStack.translatesAutoresizingMaskIntoConstraints = false
        sheetScroll.addSubview(sheetStack)
        [sheetTitle, shut, sheetScroll].forEach { sheet.addSubview($0) }
        screen.view.addSubview(sheet)
        let g = screen.mapArea
        // As tall as its rows, up to half the map; the rest scrolls.
        let h = sheetScroll.heightAnchor.constraint(equalTo: sheetStack.heightAnchor)
        h.priority = .defaultHigh
        NSLayoutConstraint.activate([
            sheet.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 12),
            sheet.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -12),
            sheet.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -12),
            sheet.heightAnchor.constraint(lessThanOrEqualTo: g.heightAnchor, multiplier: 0.5),
            sheetTitle.leadingAnchor.constraint(equalTo: sheet.leadingAnchor, constant: 14),
            sheetTitle.topAnchor.constraint(equalTo: sheet.topAnchor, constant: 12),
            shut.leadingAnchor.constraint(greaterThanOrEqualTo: sheetTitle.trailingAnchor, constant: 8),
            shut.trailingAnchor.constraint(equalTo: sheet.trailingAnchor, constant: -8),
            shut.centerYAnchor.constraint(equalTo: sheetTitle.centerYAnchor),
            shut.widthAnchor.constraint(equalToConstant: 36),
            sheetScroll.topAnchor.constraint(equalTo: sheetTitle.bottomAnchor, constant: 8),
            sheetScroll.leadingAnchor.constraint(equalTo: sheet.leadingAnchor, constant: 14),
            sheetScroll.trailingAnchor.constraint(equalTo: sheet.trailingAnchor, constant: -14),
            sheetScroll.bottomAnchor.constraint(equalTo: sheet.bottomAnchor, constant: -12),
            h,
            sheetStack.topAnchor.constraint(equalTo: sheetScroll.contentLayoutGuide.topAnchor),
            sheetStack.bottomAnchor.constraint(equalTo: sheetScroll.contentLayoutGuide.bottomAnchor),
            sheetStack.leadingAnchor.constraint(equalTo: sheetScroll.contentLayoutGuide.leadingAnchor),
            sheetStack.trailingAnchor.constraint(equalTo: sheetScroll.contentLayoutGuide.trailingAnchor),
            sheetStack.widthAnchor.constraint(equalTo: sheetScroll.frameLayoutGuide.widthAnchor)
        ])
    }

    // A box with a colour edge (the page's terrain light and stats boxes) holding a column of labels.
    private func edged(_ views: [UIView], colour: UIColor?) -> UIView {
        let v = UIView()
        v.backgroundColor = (colour ?? .lightGray).withAlphaComponent(0.16)
        v.layer.cornerRadius = 8
        let bar = UIView()
        bar.backgroundColor = colour ?? .lightGray
        bar.translatesAutoresizingMaskIntoConstraints = false
        let col = UIStackView(arrangedSubviews: views)
        col.axis = .vertical
        col.spacing = 1
        col.translatesAutoresizingMaskIntoConstraints = false
        v.addSubview(bar)
        v.addSubview(col)
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: v.leadingAnchor),
            bar.topAnchor.constraint(equalTo: v.topAnchor),
            bar.bottomAnchor.constraint(equalTo: v.bottomAnchor),
            bar.widthAnchor.constraint(equalToConstant: 5),
            col.leadingAnchor.constraint(equalTo: bar.trailingAnchor, constant: 7),
            col.trailingAnchor.constraint(equalTo: v.trailingAnchor, constant: -6),
            col.topAnchor.constraint(equalTo: v.topAnchor, constant: 5),
            col.bottomAnchor.constraint(equalTo: v.bottomAnchor, constant: -5)
        ])
        return v
    }
    // Avalanche Canada's danger colour behind its own words, as the page's chips.
    private func chip(_ text: String, bg: String, fg: String) -> UIView {
        let l = label(text, size: 11, weight: .bold, colour: NativeGround.colour(fg) ?? .black)
        l.textAlignment = .center
        l.numberOfLines = 1
        l.adjustsFontSizeToFitWidth = true
        l.minimumScaleFactor = 0.7
        l.backgroundColor = NativeGround.colour(bg) ?? .lightGray
        l.layer.cornerRadius = 5
        l.clipsToBounds = true
        l.heightAnchor.constraint(equalToConstant: 20).isActive = true
        return l
    }

    private func showSpot() {
        guard let screen = screen, screen.isViewLoaded else { return }
        if sheet.superview == nil { buildSheet(in: screen) }
        guard (info["on"] as? Bool) == true, let sp = info["spot"] as? [String: Any],
              let lat = sp["lat"] as? Double, let lon = sp["lon"] as? Double,
              asked != 0, (sp["n"] as? NSNumber)?.intValue == asked else { spotAt = nil; sheet.isHidden = true; return }
        spotAt = (lat, lon)
        let ink = UIColor(red: 0.11, green: 0.14, blue: 0.2, alpha: 1), grey = UIColor(red: 0.36, green: 0.4, blue: 0.46, alpha: 1)
        let red = UIColor(red: 0.69, green: 0.07, blue: 0.1, alpha: 1)
        sheetTitle.text = (sp["title"] as? String) ?? "This spot"
        sheetStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        links = []
        let str = { (r: [String: Any], k: String) -> String in (r[k] as? String) ?? "" }
        if let rows = sp["rows"] as? [[String: Any]] {
            for r in rows {
                let t = str(r, "t")
                switch str(r, "k") {
                case "h": sheetStack.addArrangedSubview(label(t, size: 14, weight: .bold, colour: ink))
                case "warn": sheetStack.addArrangedSubview(label(t, size: 12, weight: .semibold, colour: red))
                case "note": sheetStack.addArrangedSubview(label(t, size: 11.5, weight: .regular, colour: grey))
                case "chip":
                    let sw = UIView()
                    sw.backgroundColor = NativeGround.colour(str(r, "c")) ?? .lightGray
                    sw.layer.cornerRadius = 3
                    sw.widthAnchor.constraint(equalToConstant: 6).isActive = true
                    let row = UIStackView(arrangedSubviews: [sw, label(t, size: 12.5, weight: .regular, colour: ink)])
                    row.spacing = 8
                    sheetStack.addArrangedSubview(row)
                case "check":
                    sheetStack.addArrangedSubview(edged([label(t, size: 14, weight: .bold, colour: ink), label(str(r, "s"), size: 11.5, weight: .regular, colour: ink)], colour: NativeGround.colour(str(r, "c"))))
                case "stats":
                    let row = UIStackView()
                    row.spacing = 4
                    row.distribution = .fillEqually
                    for d in (r["d"] as? [[String: Any]]) ?? [] {
                        let b = label(str(d, "t"), size: 13, weight: .bold, colour: ink)
                        b.adjustsFontSizeToFitWidth = true
                        b.minimumScaleFactor = 0.7
                        b.numberOfLines = 2
                        row.addArrangedSubview(edged([b, label(str(d, "s"), size: 10, weight: .medium, colour: grey)], colour: NativeGround.colour(str(d, "c"))))
                    }
                    sheetStack.addArrangedSubview(row)
                case "days":
                    let row = UIStackView()
                    row.spacing = 4
                    row.distribution = .fillEqually
                    for d in (r["d"] as? [[String: Any]]) ?? [] {
                        let n = label(str(d, "n"), size: 10.5, weight: .medium, colour: grey)
                        n.textAlignment = .center
                        let col = UIStackView(arrangedSubviews: [n, chip(str(d, "t"), bg: str(d, "c"), fg: str(d, "f"))])
                        col.axis = .vertical
                        col.spacing = 2
                        row.addArrangedSubview(col)
                    }
                    sheetStack.addArrangedSubview(row)
                case "prob":
                    let off = (r["off"] as? Bool) == true
                    let col = UIStackView(arrangedSubviews: [label(t, size: 12.5, weight: .bold, colour: ink)] + ((r["d"] as? [String]) ?? []).map { label($0, size: 11.5, weight: .regular, colour: ink) })
                    col.axis = .vertical
                    col.spacing = 2
                    col.alpha = off ? 0.45 : 1
                    sheetStack.addArrangedSubview(col)
                case "sign", "li":
                    let hi = (r["hi"] as? Bool) == true
                    let sw = UIView()
                    sw.backgroundColor = str(r, "k") == "li" ? UIColor(white: 0.8, alpha: 1) : hi ? UIColor(red: 0.88, green: 0.19, blue: 0.19, alpha: 1) : UIColor(white: 0.68, alpha: 1)
                    sw.widthAnchor.constraint(equalToConstant: 3).isActive = true
                    let row = UIStackView(arrangedSubviews: [sw, label(t, size: 12, weight: .regular, colour: ink)])
                    row.spacing = 8
                    sheetStack.addArrangedSubview(row)
                case "link":
                    let u = str(r, "u")
                    guard u.hasPrefix("https://") else { continue }
                    links.append(u)
                    let b = UIButton(type: .system)
                    b.setTitle(t + " ↗", for: .normal)
                    b.titleLabel?.font = .systemFont(ofSize: 12.5, weight: .semibold)
                    b.titleLabel?.numberOfLines = 0
                    b.contentHorizontalAlignment = .leading
                    b.tag = links.count - 1
                    b.addTarget(self, action: #selector(linkTapped(_:)), for: .touchUpInside)
                    sheetStack.addArrangedSubview(b)
                default: sheetStack.addArrangedSubview(label(t, size: 12.5, weight: .regular, colour: ink))
                }
            }
            let more = UIButton(type: .system)
            more.setTitle(str(sp, "more").isEmpty ? "More about this spot ›" : str(sp, "more") + " ›", for: .normal)
            more.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
            more.contentHorizontalAlignment = .leading
            more.addTarget(self, action: #selector(moreSpot), for: .touchUpInside)
            sheetStack.addArrangedSubview(more)
        } else {
            sheetStack.addArrangedSubview(label(str(sp, "loading").isEmpty ? "Reading the terrain…" : str(sp, "loading"), size: 12, weight: .regular, colour: grey))
        }
        let fresh = sheet.isHidden
        sheet.isHidden = false
        if fresh { sheetScroll.setContentOffset(.zero, animated: false) }   // a new slope from the top; a new day keeps the place
    }

    @objc private func dayTapped(_ b: UIButton) { screen?.send("avyDay", ["i": b.tag]) }
    @objc private func closeSpot() {
        spotAt = nil
        asked = 0
        sheet.isHidden = true
        screen?.send("avySpot", ["close": true])
    }
    @objc private func moreSpot() {
        guard let at = spotAt else { return }
        screen?.leave(details: false, extra: ["avySpot": true, "spotLat": at.0, "spotLon": at.1])
    }
    @objc private func linkTapped(_ b: UIButton) {
        guard b.tag >= 0, b.tag < links.count, let u = URL(string: links[b.tag]) else { return }
        UIApplication.shared.open(u)
    }

    @objc private func toggle() { open.toggle(); show() }
    @objc private func full() { screen?.leave(details: false, extra: ["avy": true]) }
}
