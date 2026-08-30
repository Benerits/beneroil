// TANITIM VİDEOSU TAMAMLAYICI — webm'e müzik + hook sesi ekler, mp4 yazar.
// ffmpeg gerekmez: macOS'un kendi AVFoundation'ı kullanılır.
//
// Kullanım: swift tamamla.swift <video.webm|mp4> <muzik.wav> <hook.wav> <cikti.mp4>
//   hook sesi 0. saniyede tek atış çalar (dikkat çekici giriş), müzik altta döner,
//   sonda 1.2 sn yumuşak kısılma olur.

import AVFoundation
import Foundation

let a = CommandLine.arguments
guard a.count >= 5 else { print("kullanım: tamamla.swift video muzik hook cikti"); exit(1) }
let videoURL = URL(fileURLWithPath: a[1])
let muzikURL = URL(fileURLWithPath: a[2])
let hookURL  = URL(fileURLWithPath: a[3])
let ciktiURL = URL(fileURLWithPath: a[4])
try? FileManager.default.removeItem(at: ciktiURL)

let sem = DispatchSemaphore(value: 0)
var hata: String?

Task {
    do {
        let vAsset = AVURLAsset(url: videoURL)
        let mAsset = AVURLAsset(url: muzikURL)
        let hAsset = AVURLAsset(url: hookURL)

        let vSure = try await vAsset.load(.duration)
        guard let vTrack = try await vAsset.loadTracks(withMediaType: .video).first else {
            hata = "videoda görüntü izi yok"; sem.signal(); return
        }
        let comp = AVMutableComposition()
        let compV = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
        try compV.insertTimeRange(CMTimeRange(start: .zero, duration: vSure), of: vTrack, at: .zero)
        compV.preferredTransform = try await vTrack.load(.preferredTransform)

        // ── müzik izi: video dolana kadar döngü ──
        let compM = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
        if let mTrack = try await mAsset.loadTracks(withMediaType: .audio).first {
            let mSure = try await mAsset.load(.duration)
            var imlec = CMTime.zero
            while CMTimeCompare(imlec, vSure) < 0 {
                let kalan = CMTimeSubtract(vSure, imlec)
                let parca = CMTimeCompare(kalan, mSure) < 0 ? kalan : mSure
                try compM.insertTimeRange(CMTimeRange(start: .zero, duration: parca), of: mTrack, at: imlec)
                imlec = CMTimeAdd(imlec, parca)
            }
        }
        // ── hook izi: tek atış, en başta ──
        let compH = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
        if let hTrack = try await hAsset.loadTracks(withMediaType: .audio).first {
            let hSure = try await hAsset.load(.duration)
            let parca = CMTimeCompare(hSure, vSure) < 0 ? hSure : vSure
            try compH.insertTimeRange(CMTimeRange(start: .zero, duration: parca), of: hTrack, at: .zero)
        }

        // ── ses karışımı: müzik kısık zeminde, hook önde; sonda fade ──
        let mix = AVMutableAudioMix()
        let pm = AVMutableAudioMixInputParameters(track: compM)
        pm.setVolume(0.34, at: .zero)                       // müzik arka planda kalsın
        let fade = CMTime(seconds: min(1.2, CMTimeGetSeconds(vSure) / 5), preferredTimescale: 600)
        pm.setVolumeRamp(fromStartVolume: 0.34, toEndVolume: 0.0,
                         timeRange: CMTimeRange(start: CMTimeSubtract(vSure, fade), duration: fade))
        let ph = AVMutableAudioMixInputParameters(track: compH)
        ph.setVolume(0.9, at: .zero)
        mix.inputParameters = [pm, ph]

        guard let disa = AVAssetExportSession(asset: comp, presetName: AVAssetExportPreset1920x1080) else {
            hata = "dışa aktarıcı kurulamadı"; sem.signal(); return
        }
        disa.outputURL = ciktiURL
        disa.outputFileType = .mp4          // Twitter/X: H.264 + AAC
        disa.audioMix = mix
        await disa.export()
        if disa.status != .completed { hata = disa.error?.localizedDescription ?? "bilinmeyen hata" }
        sem.signal()
    } catch { hata = String(describing: error); sem.signal() }
}
sem.wait()
if let h = hata { print("HATA: \(h)"); exit(1) }
print("  ✓ \(ciktiURL.lastPathComponent)")
