import AVFoundation
import Combine
import Foundation

/// Reproductor nativo con ecualizador real (AVAudioUnitEQ).
@MainActor
final class AudioEnginePlayer: ObservableObject {
    @Published var isPlaying = false
    @Published var currentTime: TimeInterval = 0
    @Published var duration: TimeInterval = 0
    @Published var title: String = "Sin reproducción"
    @Published var subtitle: String = "Añade MP3, WAV o MP4"
    @Published var bandGains: [Float] = [0, 0, 0, 0, 0]
    @Published var tracks: [TrackItem] = []
    @Published var currentIndex: Int = -1

    struct TrackItem: Identifiable, Equatable {
        let id = UUID()
        let url: URL
        let title: String
        let ext: String
    }

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let eq = AVAudioUnitEQ(numberOfBands: 5)
    private var ticker: Timer?
    private var audioFile: AVAudioFile?
    private var sampleRate: Double = 44100
    private var frameLength: AVAudioFramePosition = 0
    private var seekFrame: AVAudioFramePosition = 0
    private var isSeeking = false

    private let freqs: [Float] = [60, 230, 910, 3600, 14000]

    init() {
        configureSession()
        configureEQ()
        engine.attach(player)
        engine.attach(eq)
        engine.connect(player, to: eq, format: nil)
        engine.connect(eq, to: engine.mainMixerNode, format: nil)
        engine.prepare()
    }

    private func configureSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [])
        try? session.setActive(true)
    }

    private func configureEQ() {
        for (i, freq) in freqs.enumerated() {
            let band = eq.bands[i]
            band.frequency = freq
            band.bypass = false
            band.gain = 0
            switch i {
            case 0:
                band.filterType = .lowShelf
                band.bandwidth = 0.8
            case freqs.count - 1:
                band.filterType = .highShelf
                band.bandwidth = 0.8
            default:
                band.filterType = .parametric
                band.bandwidth = 1.0
            }
        }
    }

    func importURLs(_ urls: [URL]) {
        for url in urls {
            let ext = url.pathExtension.lowercased()
            guard ["mp3", "wav", "m4a", "aac", "mp4", "aiff", "caf", "flac"].contains(ext) else { continue }
            let name = url.deletingPathExtension().lastPathComponent
                .replacingOccurrences(of: "_", with: " ")
                .replacingOccurrences(of: "-", with: " ")
            tracks.append(TrackItem(url: url, title: name, ext: ext))
        }
        if currentIndex < 0, !tracks.isEmpty {
            load(index: 0, autoplay: true)
        }
    }

    func load(index: Int, autoplay: Bool) {
        guard !tracks.isEmpty else { return }
        let i = (index + tracks.count) % tracks.count
        currentIndex = i
        let track = tracks[i]
        title = track.title
        subtitle = "\(track.ext.uppercased()) · pista \(i + 1) de \(tracks.count)"

        stopEnginePlayback()
        do {
            _ = track.url.startAccessingSecurityScopedResource()
            audioFile = try AVAudioFile(forReading: track.url)
            guard let file = audioFile else { return }
            sampleRate = file.processingFormat.sampleRate
            frameLength = file.length
            duration = Double(frameLength) / sampleRate
            currentTime = 0
            seekFrame = 0

            if !engine.isRunning {
                try engine.start()
            }
            schedule(from: 0)
            if autoplay {
                player.play()
                isPlaying = true
                startTicker()
            }
        } catch {
            subtitle = "No se pudo abrir el archivo"
            isPlaying = false
        }
    }

    private func schedule(from frame: AVAudioFramePosition) {
        guard let file = audioFile else { return }
        file.framePosition = frame
        let remaining = AVAudioFrameCount(max(0, frameLength - frame))
        guard remaining > 0 else { return }
        player.scheduleSegment(file, startingFrame: frame, frameCount: remaining, at: nil) { [weak self] in
            Task { @MainActor in
                self?.handleEnded()
            }
        }
    }

    private func handleEnded() {
        guard !isSeeking else { return }
        if currentIndex < tracks.count - 1 {
            load(index: currentIndex + 1, autoplay: true)
        } else {
            isPlaying = false
            currentTime = duration
            stopTicker()
        }
    }

    func togglePlay() {
        if tracks.isEmpty { return }
        if currentIndex < 0 {
            load(index: 0, autoplay: true)
            return
        }
        if isPlaying {
            player.pause()
            isPlaying = false
            stopTicker()
        } else {
            if !engine.isRunning { try? engine.start() }
            player.play()
            isPlaying = true
            startTicker()
        }
    }

    func next() { load(index: currentIndex + 1, autoplay: true) }
    func prev() {
        if currentTime > 3 {
            seek(to: 0)
        } else {
            load(index: currentIndex - 1, autoplay: true)
        }
    }

    func seek(to time: TimeInterval) {
        guard audioFile != nil else { return }
        isSeeking = true
        let frame = AVAudioFramePosition(max(0, min(time, duration)) * sampleRate)
        let wasPlaying = isPlaying
        player.stop()
        seekFrame = frame
        currentTime = Double(frame) / sampleRate
        schedule(from: frame)
        if wasPlaying {
            player.play()
            isPlaying = true
            startTicker()
        }
        isSeeking = false
    }

    func setGain(band: Int, value: Float) {
        guard band >= 0 && band < eq.bands.count else { return }
        eq.bands[band].gain = value
        bandGains[band] = value
    }

    func applyPreset(_ gains: [Float]) {
        for (i, g) in gains.enumerated() where i < eq.bands.count {
            setGain(band: i, value: g)
        }
    }

    func remove(at offsets: IndexSet) {
        for i in offsets.sorted(by: >) {
            if i == currentIndex {
                stopEnginePlayback()
                tracks.remove(at: i)
                if tracks.isEmpty {
                    currentIndex = -1
                    title = "Sin reproducción"
                    subtitle = "Añade MP3, WAV o MP4"
                    duration = 0
                    currentTime = 0
                } else {
                    load(index: min(i, tracks.count - 1), autoplay: isPlaying)
                }
            } else {
                tracks.remove(at: i)
                if i < currentIndex { currentIndex -= 1 }
            }
        }
    }

    private func stopEnginePlayback() {
        player.stop()
        isPlaying = false
        stopTicker()
    }

    private func startTicker() {
        stopTicker()
        ticker = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.updateTime()
            }
        }
    }

    private func stopTicker() {
        ticker?.invalidate()
        ticker = nil
    }

    private func updateTime() {
        guard let nodeTime = player.lastRenderTime,
              let playerTime = player.playerTime(forNodeTime: nodeTime),
              isPlaying else { return }
        let played = Double(playerTime.sampleTime) / sampleRate
        currentTime = min(duration, Double(seekFrame) / sampleRate + played)
    }
}
