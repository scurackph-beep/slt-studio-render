import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @StateObject private var player = AudioEnginePlayer()
    @State private var showImporter = false
    @State private var preset = "Plano"

    private let presets: [(String, [Float])] = [
        ("Plano", [0, 0, 0, 0, 0]),
        ("Graves+", [7, 4, 0, -1, 0]),
        ("Voz", [-2, 1, 4, 3, 0]),
        ("Electrónica", [5, 3, -1, 2, 4]),
        ("Rock", [4, 2, -1, 2, 3]),
        ("Suave", [2, 1, 0, -2, -3]),
    ]

    private let bandLabels = ["60", "230", "910", "3.6k", "14k"]

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.08, green: 0.07, blue: 0.06), Color(red: 0.03, green: 0.03, blue: 0.02)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            Circle()
                .fill(Color(red: 0.82, green: 0.48, blue: 0.27).opacity(0.22))
                .frame(width: 280, height: 280)
                .blur(radius: 60)
                .offset(x: -120, y: -180)

            Circle()
                .fill(Color(red: 0.49, green: 0.64, blue: 0.54).opacity(0.18))
                .frame(width: 240, height: 240)
                .blur(radius: 55)
                .offset(x: 140, y: 260)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("BullShit Mp3")
                                .font(.system(size: 30, weight: .bold, design: .serif))
                            Text("By Sweet Little Trauma")
                                .font(.system(size: 14, weight: .medium, design: .rounded))
                                .foregroundStyle(.white.opacity(0.5))
                        }
                        Spacer()
                        Button {
                            showImporter = true
                        } label: {
                            Label("Añadir", systemImage: "plus")
                                .font(.system(size: 15, weight: .medium))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .background(.white.opacity(0.06))
                                .clipShape(Capsule())
                                .overlay(Capsule().stroke(.white.opacity(0.12)))
                        }
                        .foregroundStyle(.white)
                    }

                    nowPlayingCard
                    eqCard
                    playlistCard
                }
                .padding(.horizontal, 18)
                .padding(.top, 12)
                .padding(.bottom, 36)
            }
        }
        .fileImporter(
            isPresented: $showImporter,
            allowedContentTypes: [.audio, .mpeg4Movie, .mp3, .wav, .mpeg4Audio],
            allowsMultipleSelection: true
        ) { result in
            if case .success(let urls) = result {
                player.importURLs(urls)
            }
        }
    }

    private var nowPlayingCard: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle()
                    .stroke(
                        AngularGradient(
                            colors: [
                                Color(red: 0.82, green: 0.48, blue: 0.27).opacity(0.7),
                                .clear,
                                Color(red: 0.49, green: 0.64, blue: 0.54).opacity(0.55),
                                .clear,
                                Color(red: 0.82, green: 0.48, blue: 0.27).opacity(0.7),
                            ],
                            center: .center
                        ),
                        lineWidth: 3
                    )
                    .frame(width: 190, height: 190)
                    .rotationEffect(.degrees(player.isPlaying ? 360 : 0))
                    .animation(player.isPlaying ? .linear(duration: 10).repeatForever(autoreverses: false) : .default, value: player.isPlaying)

                Circle()
                    .fill(
                        LinearGradient(
                            colors: [Color(red: 0.16, green: 0.14, blue: 0.12), Color(red: 0.08, green: 0.07, blue: 0.06)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 160, height: 160)
                    .overlay {
                        Image(systemName: "music.note")
                            .font(.system(size: 36, weight: .light))
                            .foregroundStyle(.white.opacity(0.75))
                    }
            }

            VStack(spacing: 6) {
                Text(player.title)
                    .font(.system(size: 24, weight: .semibold, design: .serif))
                    .multilineTextAlignment(.center)
                Text(player.subtitle)
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.5))
            }

            VStack(spacing: 6) {
                Slider(
                    value: Binding(
                        get: { player.currentTime },
                        set: { player.seek(to: $0) }
                    ),
                    in: 0...max(player.duration, 0.1)
                )
                .tint(Color(red: 0.82, green: 0.48, blue: 0.27))

                HStack {
                    Text(timeString(player.currentTime))
                    Spacer()
                    Text(timeString(player.duration))
                }
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(.white.opacity(0.45))
            }

            HStack(spacing: 22) {
                Button { player.prev() } label: {
                    Image(systemName: "backward.fill").font(.title2)
                }
                Button { player.togglePlay() } label: {
                    Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                        .font(.title)
                        .foregroundStyle(Color(red: 0.1, green: 0.07, blue: 0.05))
                        .frame(width: 72, height: 72)
                        .background(
                            LinearGradient(
                                colors: [Color(red: 0.88, green: 0.54, blue: 0.32), Color(red: 0.72, green: 0.38, blue: 0.21)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .clipShape(Circle())
                        .shadow(color: Color(red: 0.82, green: 0.48, blue: 0.27).opacity(0.4), radius: 16, y: 8)
                }
                Button { player.next() } label: {
                    Image(systemName: "forward.fill").font(.title2)
                }
            }
            .foregroundStyle(.white)
            .padding(.top, 4)
        }
        .padding(20)
        .background(.ultraThinMaterial.opacity(0.35))
        .background(Color.white.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(.white.opacity(0.1))
        )
    }

    private var eqCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Ecualizador")
                    .font(.system(size: 20, weight: .semibold, design: .serif))
                Spacer()
                Picker("Preset", selection: $preset) {
                    ForEach(presets.map(\.0), id: \.self) { name in
                        Text(name).tag(name)
                    }
                }
                .pickerStyle(.menu)
                .onChange(of: preset) { _, newValue in
                    if let gains = presets.first(where: { $0.0 == newValue })?.1 {
                        player.applyPreset(gains)
                    }
                }
            }

            HStack(alignment: .bottom, spacing: 10) {
                ForEach(0..<5, id: \.self) { i in
                    VStack(spacing: 8) {
                        Text(bandLabels[i])
                            .font(.system(size: 11))
                            .foregroundStyle(.white.opacity(0.45))
                        Slider(
                            value: Binding(
                                get: { Double(player.bandGains[i]) },
                                set: { player.setGain(band: i, value: Float($0)); preset = "Personalizado" }
                            ),
                            in: -12...12,
                            step: 1
                        )
                        .rotationEffect(.degrees(-90))
                        .frame(width: 120, height: 28)
                        .frame(width: 36, height: 120)
                        .tint(Color(red: 0.82, green: 0.48, blue: 0.27))
                        Text(String(format: "%+.0f", player.bandGains[i]))
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                    .frame(maxWidth: .infinity)
                }
            }

            Text("EQ real con AVAudioUnitEQ (DSP nativo de iOS).")
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.4))
        }
        .padding(16)
        .background(.ultraThinMaterial.opacity(0.35))
        .background(Color.white.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(.white.opacity(0.1))
        )
    }

    private var playlistCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Lista")
                    .font(.system(size: 20, weight: .semibold, design: .serif))
                Spacer()
                Text("\(player.tracks.count)")
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.5))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.white.opacity(0.06))
                    .clipShape(Capsule())
            }

            if player.tracks.isEmpty {
                Text("Toca Añadir y elige MP3, WAV o MP4 desde Archivos.")
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.45))
            } else {
                ForEach(Array(player.tracks.enumerated()), id: \.element.id) { index, track in
                    Button {
                        player.load(index: index, autoplay: true)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(track.title)
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundStyle(.white)
                                    .lineLimit(1)
                                Text(track.ext.uppercased())
                                    .font(.system(size: 12))
                                    .foregroundStyle(.white.opacity(0.4))
                            }
                            Spacer()
                            if index == player.currentIndex {
                                Image(systemName: "waveform")
                                    .foregroundStyle(Color(red: 0.82, green: 0.48, blue: 0.27))
                            }
                        }
                        .padding(12)
                        .background(index == player.currentIndex ? Color(red: 0.82, green: 0.48, blue: 0.27).opacity(0.14) : Color.white.opacity(0.03))
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(index == player.currentIndex ? Color(red: 0.82, green: 0.48, blue: 0.27).opacity(0.45) : .clear)
                        )
                    }
                }
            }
        }
        .padding(16)
        .background(.ultraThinMaterial.opacity(0.35))
        .background(Color.white.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(.white.opacity(0.1))
        )
    }

    private func timeString(_ t: TimeInterval) -> String {
        guard t.isFinite && t >= 0 else { return "0:00" }
        let m = Int(t) / 60
        let s = Int(t) % 60
        return String(format: "%d:%02d", m, s)
    }
}

#Preview {
    ContentView()
}
