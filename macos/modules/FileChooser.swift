import AppKit
import UniformTypeIdentifiers

final class FileChooser: ExactModule {
    private var panel: NSSavePanel?
    private let drawingFilter = DrawingFilter()
    private let destinationFilter = DrawingFilter(rejectExisting: true)
    private var service: Process?
    private var serviceOutput: Pipe?
    private var serviceLog: FileHandle?
    private var serviceReady = false
    private var startupReplies: [ExactReply] = []
    private var startupText = ""

    override func later(_ request: [String: Any], reply: ExactReply) {
        if request["op"] as? String == "start-service" {
            startService(reply)
            return
        }
        if request["op"] as? String == "destination" {
            chooseDestination(request, reply: reply)
            return
        }
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
        present(chooser, reply: reply)
    }

    private func chooseDestination(_ request: [String: Any], reply: ExactReply) {
        guard let kind = request["kind"] as? String, ["new", "save-as", "move"].contains(kind) else {
            reply.fail("Unknown drawing destination request.")
            return
        }
        guard panel == nil else { reply.fail("A file chooser is already open."); return }
        let chooser = NSSavePanel()
        switch kind {
        case "new":
            chooser.title = "New drawing"
            chooser.prompt = "Create"
        case "move":
            chooser.title = "Move drawing"
            chooser.prompt = "Move"
        default:
            chooser.title = "Save drawing as"
            chooser.prompt = "Save"
        }
        chooser.allowedContentTypes = [UTType(filenameExtension: "excalidraw") ?? .data]
        chooser.allowsOtherFileTypes = false
        chooser.canCreateDirectories = true
        chooser.treatsFilePackagesAsDirectories = false
        chooser.nameFieldStringValue = request["name"] as? String ?? "Untitled.excalidraw"
        chooser.delegate = destinationFilter
        if let path = request["path"] as? String, !path.isEmpty {
            let url = URL(fileURLWithPath: path)
            let directory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
            chooser.directoryURL = directory ? url : url.deletingLastPathComponent()
        }
        present(chooser, reply: reply)
    }

    private func present(_ chooser: NSSavePanel, reply: ExactReply) {
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

    private func finishStartup(_ error: String? = nil) {
        let replies = startupReplies
        startupReplies = []
        for reply in replies {
            if let error { reply.fail(error) }
            else { reply.send(["ready": true]) }
        }
    }

    private func startService(_ reply: ExactReply) {
        if serviceReady, service?.isRunning == true { reply.send(["ready": true]); return }
        startupReplies.append(reply)
        if service?.isRunning == true { return }
        guard let resources = Bundle.main.resourceURL else {
            finishStartup("The app's resources are missing.")
            return
        }
        let directory = resources.appendingPathComponent("server")
        let process = Process()
        process.executableURL = directory.appendingPathComponent("bun")
        process.arguments = [directory.appendingPathComponent("desktop.js").path]
        process.currentDirectoryURL = directory
        var environment = ProcessInfo.processInfo.environment
        environment["EXACT_DRAW_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        process.environment = environment
        let output = Pipe()
        process.standardOutput = output
        do {
            let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Exact Draw")
            try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
            let log = logs.appendingPathComponent("service.log")
            if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
            let handle = try FileHandle(forWritingTo: log)
            try handle.seekToEnd()
            serviceLog = handle
            process.standardError = handle
        } catch {
            finishStartup("Could not open the file service log: \(error.localizedDescription)")
            return
        }
        service = process
        serviceOutput = output
        serviceReady = false
        startupText = ""
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async {
                guard let self, self.service === process else { return }
                self.startupText += String(decoding: data, as: UTF8.self)
                if self.startupText.contains("EXACT_DRAW_READY") {
                    self.serviceReady = true
                    self.finishStartup()
                }
            }
        }
        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, self.service === process else { return }
                self.serviceReady = false
                self.serviceOutput?.fileHandleForReading.readabilityHandler = nil
                self.finishStartup("The file service stopped. See ~/Library/Logs/Exact Draw/service.log.")
                try? self.serviceLog?.close()
                self.serviceLog = nil
                self.service = nil
            }
        }
        do { try process.run() }
        catch {
            output.fileHandleForReading.readabilityHandler = nil
            service = nil
            finishStartup("Could not start the bundled file service: \(error.localizedDescription)")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self, self.service === process, !self.serviceReady else { return }
            self.finishStartup("The bundled file service did not start in time.")
            if process.isRunning { process.terminate() }
        }
    }

    override func destroy() {
        panel?.cancel(nil)
        panel = nil
        serviceOutput?.fileHandleForReading.readabilityHandler = nil
        finishStartup("The app is closing.")
        if service?.isRunning == true { service?.terminate() }
    }
}

private final class DrawingFilter: NSObject, NSOpenSavePanelDelegate {
    private let rejectExisting: Bool

    init(rejectExisting: Bool = false) {
        self.rejectExisting = rejectExisting
        super.init()
    }

    func panel(_ sender: Any, shouldEnable url: URL) -> Bool {
        let directory = (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        return directory || url.pathExtension == "excalidraw"
    }

    func panel(_ sender: Any, validate url: URL) throws {
        guard url.pathExtension == "excalidraw" else {
            throw NSError(domain: "ExactDraw", code: 1, userInfo: [NSLocalizedDescriptionKey: "Choose a .excalidraw drawing."])
        }
        if rejectExisting && FileManager.default.fileExists(atPath: url.path) {
            throw NSError(domain: "ExactDraw", code: 2, userInfo: [NSLocalizedDescriptionKey: "A drawing already exists at this location. Choose a new name or another folder."])
        }
    }
}

let exactModule: ExactModule.Type = FileChooser.self
