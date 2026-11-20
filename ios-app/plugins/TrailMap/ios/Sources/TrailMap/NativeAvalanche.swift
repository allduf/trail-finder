import Foundation
import MapLibre
import UIKit

// The avalanche card in native 3D (step 8 of the native 3D plan, alex 2026-11-20; avalanche-rules). The slope colours
// themselves come through NativeGround (the page's own paint(), lossless). This card goes with them: it shows, word for
// word, what the page's own avalanche card says (native-avalanche.js reads it), so it can never say anything else:
//   { on, title, warn: [..], bands: [{ r: rating, n: band, c: colour, t: text colour }], line, notes: [..] }
// Warnings (example, expired, an old copy, no forecast) always show in full, in red, above the ratings. The notes (what
// the colours and the darker shade mean, the treeline estimate) show when the card is tapped open, with "Full forecast",
// which goes back to the page's card. Nothing shows while the page sends on: false.
final class NativeAvalanche: NativeLayer {
    let key = "avy"
    private weak var screen: TrailMapScreen?
    private var info: [String: Any] = ["on": false]
    private var open = false
    private let box = UIView()
    private let stack = UIStackView()

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        self.screen = screen
        show()
        screen.onEvent?("avyReady", [:])   // this build shows the card: the page may send the colours (native-avalanche.js)
    }

    func setData(_ json: String, style: MLNStyle?) {
        info = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? ["on": false]
        show()
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
            let g = screen.view.safeAreaLayoutGuide
            NSLayoutConstraint.activate([
                stack.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 10),
                stack.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -10),
                stack.topAnchor.constraint(equalTo: box.topAnchor, constant: 8),
                stack.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -8),
                box.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 12),
                box.widthAnchor.constraint(lessThanOrEqualToConstant: 300),
                box.trailingAnchor.constraint(lessThanOrEqualTo: g.trailingAnchor, constant: -12),
                // Under the radar and smoke captions (NativeWeather.swift rows 0-1). The ground keys share this spot, but
                // the page turns the other ground layers off while avalanche is on (winter.js oneGround).
                box.topAnchor.constraint(equalTo: g.topAnchor, constant: 148)
            ])
        }
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        guard (info["on"] as? Bool) == true else { box.isHidden = true; return }
        box.isHidden = false
        let ink = UIColor(red: 0.11, green: 0.14, blue: 0.2, alpha: 1)
        let title = (info["title"] as? String) ?? ""
        stack.addArrangedSubview(label(title.isEmpty ? "Avalanche" : "Avalanche · " + title, size: 13, weight: .bold, colour: ink))
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
        let line = (info["line"] as? String) ?? ""
        if !line.isEmpty { stack.addArrangedSubview(label(line, size: 11.5, weight: .regular, colour: ink)) }
        if open {
            for n in (info["notes"] as? [String]) ?? [] where !n.isEmpty {
                stack.addArrangedSubview(label(n, size: 10.5, weight: .regular, colour: UIColor(red: 0.36, green: 0.4, blue: 0.46, alpha: 1)))
            }
            let more = UIButton(type: .system)
            more.setTitle("Full forecast ›", for: .normal)
            more.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
            more.contentHorizontalAlignment = .leading
            more.addTarget(self, action: #selector(full), for: .touchUpInside)
            stack.addArrangedSubview(more)
        } else if !((info["notes"] as? [String]) ?? []).isEmpty {
            stack.addArrangedSubview(label("Tap for what the colours mean", size: 10.5, weight: .medium, colour: UIColor(red: 0.12, green: 0.37, blue: 0.88, alpha: 1)))
        }
    }

    @objc private func toggle() { open.toggle(); show() }
    @objc private func full() { screen?.leave(details: false, extra: ["avy": true]) }
}
