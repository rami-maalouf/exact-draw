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
    private var pendingMenuCommand: String?
    private lazy var fileMenu = DrawingFileMenu(canChoose: { [weak self] in self?.panel == nil }) { [weak self] action in
        guard let self else { return }
        self.pendingMenuCommand = action
        self.context.changed("file-menu")
    }

    override func call(_ request: [String: Any]) throws -> [String: Any] {
        switch request["op"] as? String {
        case "menu-state":
            fileMenu.sync(hasDocument: request["hasDocument"] as? Bool == true)
        case "take-menu-command":
            let action = pendingMenuCommand ?? ""
            pendingMenuCommand = nil
            return ["action": action]
        case "menu-command-finished":
            fileMenu.busy = false
        default:
            throw ExactNativeRefusal("Unknown native menu request.")
        }
        return ["ok": true]
    }

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
        fileMenu.remove()
        pendingMenuCommand = nil
        panel?.cancel(nil)
        panel = nil
        serviceOutput?.fileHandleForReading.readabilityHandler = nil
        finishStartup("The app is closing.")
        if service?.isRunning == true { service?.terminate() }
    }
}

private final class DrawingFileMenu: NSObject, NSMenuItemValidation {
    private weak var menu: NSMenu?
    private var items: [NSMenuItem] = []
    private var displacedShortcuts: [(NSMenuItem, String, NSEvent.ModifierFlags)] = []
    private var hasDocument = false
    var busy = false
    private let canChoose: () -> Bool
    private let perform: (String) -> Void
    private let documentActions: Set<String> = ["save-as", "rename", "duplicate", "move", "history", "close", "trash"]

    init(canChoose: @escaping () -> Bool, perform: @escaping (String) -> Void) {
        self.canChoose = canChoose
        self.perform = perform
        super.init()
    }

    func sync(hasDocument: Bool) {
        self.hasDocument = hasDocument
        guard let target = NSApp.mainMenu?.items.compactMap(\.submenu).first(where: {
            $0.items.contains { $0.action == #selector(NSWindow.performClose(_:)) }
        }) else { return }
        if menu !== target {
            remove()
            menu = target
            let commands: [(String, String)] = [
                ("new", "New Drawing…"), ("open", "Open Drawing…"),
                ("save-as", "Save As…"), ("rename", "Rename…"),
                ("duplicate", "Duplicate"), ("move", "Move…"),
                ("history", "Version History…"), ("close", "Close Drawing"),
                ("reopen", "Reopen Closed Drawing"), ("trash", "Move to Trash…"),
                ("show-trash", "Recently Deleted…"),
            ]
            for (action, title) in commands {
                let item = NSMenuItem(title: title, action: #selector(activate(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = action
                target.insertItem(item, at: items.count)
                items.append(item)
            }
            let separator = NSMenuItem.separator()
            target.insertItem(separator, at: items.count)
            items.append(separator)
        }
        let chords: [String: (String, NSEvent.ModifierFlags)] = [
            "new": ("n", .command), "open": ("o", .command),
            "save-as": ("s", [.command, .shift]), "close": ("w", .command),
        ]
        let mask: NSEvent.ModifierFlags = [.command, .shift, .option, .control]
        var menus = NSApp.mainMenu.map { [$0] } ?? []
        while let current = menus.popLast() {
            for item in current.items {
                if let submenu = item.submenu { menus.append(submenu) }
                guard !items.contains(where: { $0 === item }), !item.keyEquivalent.isEmpty,
                      chords.values.contains(where: { key, modifiers in
                          key == item.keyEquivalent.lowercased() && modifiers == item.keyEquivalentModifierMask.intersection(mask)
                      }) else { continue }
                if !displacedShortcuts.contains(where: { $0.0 === item }) {
                    displacedShortcuts.append((item, item.keyEquivalent, item.keyEquivalentModifierMask))
                }
                item.keyEquivalent = ""
            }
        }
        // appkit caches equivalents; release host chords before assigning ours.
        for item in items {
            guard let action = item.representedObject as? String, let (key, modifiers) = chords[action] else { continue }
            item.keyEquivalent = key
            item.keyEquivalentModifierMask = modifiers
        }
        target.update()
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        guard let action = item.representedObject as? String else { return false }
        return !busy && canChoose() && (!documentActions.contains(action) || hasDocument)
    }

    @objc private func activate(_ item: NSMenuItem) {
        guard validateMenuItem(item), let action = item.representedObject as? String else { return }
        busy = true
        perform(action)
    }

    func remove() {
        for item in items { item.menu?.removeItem(item) }
        items.removeAll()
        for (item, key, modifiers) in displacedShortcuts {
            item.keyEquivalent = key
            item.keyEquivalentModifierMask = modifiers
        }
        displacedShortcuts.removeAll()
        menu = nil
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
