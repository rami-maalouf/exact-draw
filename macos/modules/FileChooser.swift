import AppKit
import UniformTypeIdentifiers

final class FileChooser: ExactModule {
    private var panel: NSOpenPanel?
    private let drawingFilter = DrawingFilter()

    override func later(_ request: [String: Any], reply: ExactReply) {
        guard request["op"] as? String == "choose",
              let kind = request["kind"] as? String, ["file", "folder"].contains(kind) else {
            reply.fail("Unknown file chooser request.")
            return
        }
        guard panel == nil else { reply.fail("A file chooser is already open."); return }
        let chooser = NSOpenPanel()
        let folder = kind == "folder"
        chooser.title = folder ? "Open folder" : "Open drawing"
        chooser.prompt = "Open"
        chooser.canChooseFiles = !folder
        chooser.canChooseDirectories = folder
        chooser.allowsMultipleSelection = false
        chooser.treatsFilePackagesAsDirectories = false
        chooser.canCreateDirectories = false
        chooser.allowsOtherFileTypes = false
        if !folder {
            chooser.allowedContentTypes = [UTType(filenameExtension: "excalidraw") ?? .data]
            chooser.delegate = drawingFilter
        }
        panel = chooser
        let finish: (NSApplication.ModalResponse) -> Void = { [weak self, weak chooser] response in
            self?.panel = nil
            guard response == .OK, let url = chooser?.url else {
                reply.send(["cancelled": true])
                return
            }
            reply.send(["cancelled": false, "path": url.standardizedFileURL.path])
        }
        if let window = NSApp.keyWindow ?? NSApp.mainWindow {
            chooser.beginSheetModal(for: window, completionHandler: finish)
        } else {
            chooser.begin(completionHandler: finish)
        }
    }

    override func destroy() { panel?.cancel(nil); panel = nil }
}

private final class DrawingFilter: NSObject, NSOpenSavePanelDelegate {
    func panel(_ sender: Any, shouldEnable url: URL) -> Bool {
        let directory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        return directory || url.pathExtension == "excalidraw"
    }

    func panel(_ sender: Any, validate url: URL) throws {
        guard url.pathExtension == "excalidraw" else {
            throw NSError(domain: "ExactDraw", code: 1, userInfo: [NSLocalizedDescriptionKey: "Choose a .excalidraw drawing."])
        }
    }
}

let exactModule: ExactModule.Type = FileChooser.self
