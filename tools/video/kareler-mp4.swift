// PNG KARELERİNDEN MP4 — ffmpeg gerekmez, macOS AVAssetWriter kullanır.
// Playwright'ın ffmpeg'i yalnız webm yazıyor, AVFoundation ise webm okuyamıyor;
// bu yüzden video kare kare yakalanıp burada birleştiriliyor.
//
// Kullanım: swift kareler-mp4.swift <kareler-klasoru> <fps> <cikti.mp4>

import AVFoundation
import AppKit
import Foundation

let a = CommandLine.arguments
guard a.count >= 4 else { print("kullanım: kareler-mp4.swift klasor fps cikti.mp4"); exit(1) }
let klasor = URL(fileURLWithPath: a[1])
let fps = Int32(a[2]) ?? 15
let cikti = URL(fileURLWithPath: a[3])
try? FileManager.default.removeItem(at: cikti)

let kareler = (try? FileManager.default.contentsOfDirectory(at: klasor, includingPropertiesForKeys: nil))?
    .filter { ["png", "jpg", "jpeg"].contains($0.pathExtension.lowercased()) }
    .sorted { $0.lastPathComponent < $1.lastPathComponent } ?? []
guard !kareler.isEmpty, let ilk = NSImage(contentsOf: kareler[0]) else {
    print("HATA: kare bulunamadı: \(klasor.path)"); exit(1)
}
let en = Int(ilk.size.width), boy = Int(ilk.size.height)
print("  \(kareler.count) kare · \(en)x\(boy) · \(fps) fps")

let writer = try! AVAssetWriter(outputURL: cikti, fileType: .mp4)
let ayar: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: en, AVVideoHeightKey: boy,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 7_000_000,          // Twitter için bol, net görüntü
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    ],
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: ayar)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input,
    sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
                                  kCVPixelBufferWidthKey as String: en,
                                  kCVPixelBufferHeightKey as String: boy])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

func buffer(_ url: URL) -> CVPixelBuffer? {
    guard let img = NSImage(contentsOf: url),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
    var pb: CVPixelBuffer?
    CVPixelBufferCreate(kCFAllocatorDefault, en, boy, kCVPixelFormatType_32ARGB, nil, &pb)
    guard let b = pb else { return nil }
    CVPixelBufferLockBaseAddress(b, [])
    defer { CVPixelBufferUnlockBaseAddress(b, []) }
    guard let ctx = CGContext(data: CVPixelBufferGetBaseAddress(b), width: en, height: boy,
                              bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(b),
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { return nil }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: en, height: boy))
    return b
}

let sem = DispatchSemaphore(value: 0)
var i = 0
let kuyruk = DispatchQueue(label: "kare")
input.requestMediaDataWhenReady(on: kuyruk) {
    while input.isReadyForMoreMediaData {
        if i >= kareler.count { input.markAsFinished(); sem.signal(); return }
        if let b = buffer(kareler[i]) {
            adaptor.append(b, withPresentationTime: CMTime(value: CMTimeValue(i), timescale: fps))
        }
        i += 1
    }
}
sem.wait()
let bitti = DispatchSemaphore(value: 0)
writer.finishWriting { bitti.signal() }
bitti.wait()
if writer.status == .completed { print("  ✓ \(cikti.lastPathComponent)") }
else { print("HATA: \(writer.error?.localizedDescription ?? "?")"); exit(1) }
