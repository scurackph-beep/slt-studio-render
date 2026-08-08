import UIKit
import Capacitor
import AVFoundation
import MediaPlayer

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureBackgroundAudio()
        return true
    }

    private func configureBackgroundAudio() {
        let session = AVAudioSession.sharedInstance()
        do {
            // Playback continues in background / lock screen / car Bluetooth (A2DP)
            try session.setCategory(
                .playback,
                mode: .default,
                options: [.allowAirPlay, .allowBluetoothA2DP]
            )
            try session.setActive(true, options: [])
        } catch {
            print("SLT Media audio session error: \(error)")
        }

        UIApplication.shared.beginReceivingRemoteControlEvents()

        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true

        // Handlers are no-ops here; WKWebView Media Session + HTMLAudioElement drive playback.
        // Enabling commands keeps CarPlay / Bluetooth head-unit controls alive.
        center.playCommand.addTarget { _ in .success }
        center.pauseCommand.addTarget { _ in .success }
        center.togglePlayPauseCommand.addTarget { _ in .success }
        center.nextTrackCommand.addTarget { _ in .success }
        center.previousTrackCommand.addTarget { _ in .success }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioInterruption),
            name: AVAudioSession.interruptionNotification,
            object: session
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRouteChange),
            name: AVAudioSession.routeChangeNotification,
            object: session
        )
    }

    @objc private func handleAudioInterruption(_ notification: Notification) {
        guard
            let info = notification.userInfo,
            let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: typeValue)
        else { return }

        if type == .ended {
            let options = (info[AVAudioSessionInterruptionOptionKey] as? UInt)
                .flatMap(AVAudioSession.InterruptionOptions.init(rawValue:))
            do {
                try AVAudioSession.sharedInstance().setActive(true)
            } catch {
                print("SLT Media reactivate session: \(error)")
            }
            if options?.contains(.shouldResume) == true {
                NotificationCenter.default.post(name: Notification.Name("SLTMediaShouldResume"), object: nil)
            }
        }
    }

    @objc private func handleRouteChange(_ notification: Notification) {
        // Keep session active when switching to car Bluetooth / AirPlay
        do {
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("SLT Media route change: \(error)")
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Do NOT pause audio — car Bluetooth / background playback must continue.
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // no-op
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
