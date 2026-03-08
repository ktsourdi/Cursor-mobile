import SwiftUI
import CursorMobileShared

// MARK: - Session Storage

/// Persists session credentials across app launches.
@MainActor
final class SessionStore: ObservableObject {
    @Published var isPaired = false
    @Published var serverAddress: String = ""

    private let addressKey = "companion_server_address"
    private let tokenKey = "companion_session_token"

    var apiClient: CompanionAPIClient?

    init() {
        if let address = UserDefaults.standard.string(forKey: addressKey),
           let token = UserDefaults.standard.string(forKey: tokenKey),
           let url = URL(string: "http://\(address)") {
            serverAddress = address
            let client = CompanionAPIClient(baseURL: url)
            apiClient = client
            Task {
                await client.setSessionToken(token)
                self.isPaired = true
            }
        }
    }

    func save(address: String, token: String) {
        serverAddress = address
        UserDefaults.standard.set(address, forKey: addressKey)
        UserDefaults.standard.set(token, forKey: tokenKey)
        let client = CompanionAPIClient(baseURL: URL(string: "http://\(address)")!)
        apiClient = client
        Task {
            await client.setSessionToken(token)
            self.isPaired = true
        }
    }

    func logout() {
        UserDefaults.standard.removeObject(forKey: addressKey)
        UserDefaults.standard.removeObject(forKey: tokenKey)
        apiClient = nil
        isPaired = false
        serverAddress = ""
    }
}

// MARK: - App Entry Point

/// Main entry point for the Cursor Mobile iPhone app.
@main
struct CursorMobileAppMain: App {
    @StateObject private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(session)
        }
    }
}

/// Root content view that handles navigation based on pairing state.
struct ContentView: View {
    @EnvironmentObject var session: SessionStore

    var body: some View {
        NavigationStack {
            if session.isPaired {
                ProjectListView()
            } else {
                PairDeviceView()
            }
        }
    }
}

// MARK: - Pair Device View

struct PairDeviceView: View {
    @EnvironmentObject var session: SessionStore
    @State private var serverAddress = ""
    @State private var pairingCode = ""
    @State private var isConnecting = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "iphone.and.arrow.forward")
                .font(.system(size: 60))
                .foregroundColor(.accentColor)

            Text("Pair with Mac Companion")
                .font(.title2.bold())

            Text("Enter the address shown in the Mac companion app to connect.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            TextField("Server Address (e.g. 192.168.1.100:24842)", text: $serverAddress)
                .textFieldStyle(.roundedBorder)
                .autocapitalization(.none)
                .disableAutocorrection(true)
                .padding(.horizontal)

            TextField("Pairing Code (optional)", text: $pairingCode)
                .textFieldStyle(.roundedBorder)
                .autocapitalization(.none)
                .disableAutocorrection(true)
                .padding(.horizontal)

            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
                    .padding(.horizontal)
            }

            Button(action: { Task { await pair() } }) {
                if isConnecting {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Connect")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal)
            .disabled(serverAddress.isEmpty || isConnecting)
        }
        .padding()
        .navigationTitle("Setup")
    }

    private func pair() async {
        isConnecting = true
        errorMessage = nil

        guard let url = URL(string: "http://\(serverAddress)") else {
            errorMessage = "Invalid server address"
            isConnecting = false
            return
        }

        let client = CompanionAPIClient(baseURL: url)

        do {
            // Step 1: Check server is reachable
            _ = try await client.getStatus()

            // Step 2: Start pairing
            let deviceName = UIDevice.current.name
            let pairResult = try await client.startPairing(deviceName: deviceName)

            // Step 3: Confirm pairing (use generated token or user-provided code)
            let tokenToUse = pairingCode.isEmpty ? pairResult.pairingToken : pairingCode
            let confirmResult = try await client.confirmPairing(
                deviceId: pairResult.deviceId,
                pairingToken: tokenToUse
            )

            // Step 4: Save session
            session.save(address: serverAddress, token: confirmResult.sessionToken)
        } catch {
            errorMessage = "Connection failed: \(error.localizedDescription)"
        }

        isConnecting = false
    }
}

// MARK: - Project List View

struct ProjectListView: View {
    @EnvironmentObject var session: SessionStore
    @State private var projects: [Project] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        List(projects) { project in
            NavigationLink(destination: ThreadListView(project: project)) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(project.name)
                        .font(.headline)
                    if let branch = project.git?.currentBranch ?? project.currentBranch {
                        Label(branch, systemImage: "arrow.triangle.branch")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    if let commit = project.git?.lastCommitMessage {
                        Text(commit)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .navigationTitle("Projects")
        .refreshable { await loadProjects() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button(action: { Task { await loadProjects() } }) {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    Button(role: .destructive, action: { session.logout() }) {
                        Label("Disconnect", systemImage: "wifi.slash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .overlay {
            if projects.isEmpty && !isLoading {
                ContentUnavailableView(
                    "No Projects",
                    systemImage: "folder",
                    description: Text("Pull down to refresh, or scan projects from the Mac companion.")
                )
            }
        }
        .overlay {
            if isLoading && projects.isEmpty {
                ProgressView("Loading projects...")
            }
        }
        .alert("Error", isPresented: .init(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .task { await loadProjects() }
    }

    private func loadProjects() async {
        guard let client = session.apiClient else { return }
        isLoading = true
        do {
            projects = try await client.getProjects()
        } catch {
            if projects.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
        isLoading = false
    }
}

// MARK: - Thread List View

struct ThreadListView: View {
    @EnvironmentObject var session: SessionStore
    let project: Project
    @State private var threads: [ConversationThread] = []
    @State private var isLoading = false
    @State private var showNewThread = false
    @State private var newThreadTitle = ""
    @State private var errorMessage: String?

    var body: some View {
        List(threads) { thread in
            NavigationLink(destination: ThreadDetailView(thread: thread)) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(thread.title)
                        .font(.headline)
                    HStack {
                        Label(thread.originType.rawValue, systemImage: "tag")
                            .font(.caption2)
                        Spacer()
                        Text(formatDate(thread.updatedAt))
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .navigationTitle(project.name)
        .refreshable { await loadThreads() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: { showNewThread = true }) {
                    Image(systemName: "plus")
                }
            }
        }
        .overlay {
            if threads.isEmpty && !isLoading {
                ContentUnavailableView(
                    "No Conversations",
                    systemImage: "bubble.left.and.bubble.right",
                    description: Text("Tap + to start a new conversation thread.")
                )
            }
        }
        .alert("New Thread", isPresented: $showNewThread) {
            TextField("Thread title", text: $newThreadTitle)
            Button("Create") { Task { await createThread() } }
            Button("Cancel", role: .cancel) { newThreadTitle = "" }
        } message: {
            Text("Enter a title for the new conversation thread.")
        }
        .alert("Error", isPresented: .init(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .task { await loadThreads() }
    }

    private func loadThreads() async {
        guard let client = session.apiClient else { return }
        isLoading = true
        do {
            threads = try await client.getThreads(projectId: project.id)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func createThread() async {
        guard let client = session.apiClient, !newThreadTitle.isEmpty else { return }
        do {
            let thread = try await client.createThread(projectId: project.id, title: newThreadTitle)
            threads.insert(thread, at: 0)
            newThreadTitle = ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func formatDate(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) {
            let relative = RelativeDateTimeFormatter()
            relative.unitsStyle = .abbreviated
            return relative.localizedString(for: date, relativeTo: Date())
        }
        // Try without fractional seconds
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: iso) {
            let relative = RelativeDateTimeFormatter()
            relative.unitsStyle = .abbreviated
            return relative.localizedString(for: date, relativeTo: Date())
        }
        return iso
    }
}

// MARK: - Thread Detail View

struct ThreadDetailView: View {
    @EnvironmentObject var session: SessionStore
    let thread: ConversationThread
    @State private var messages: [Message] = []
    @State private var newMessage = ""
    @State private var isSending = false
    @State private var connectionStatus = "Connecting..."
    @State private var wsTask: URLSessionWebSocketTask?
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            // Connection status bar
            HStack {
                Circle()
                    .fill(connectionStatus == "Connected" ? .green : .orange)
                    .frame(width: 8, height: 8)
                Text(connectionStatus)
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                Text("\(messages.count) messages")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal)
            .padding(.vertical, 4)
            .background(Color(.systemBackground))

            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: messages.count) { _, _ in
                    if let last = messages.last {
                        withAnimation {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }

            // Input bar
            HStack(spacing: 8) {
                TextField("Message...", text: $newMessage)
                    .textFieldStyle(.roundedBorder)
                    .disabled(isSending)

                Button(action: { Task { await sendMessage() } }) {
                    if isSending {
                        ProgressView()
                            .frame(width: 28, height: 28)
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                    }
                }
                .disabled(newMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
            }
            .padding()
        }
        .navigationTitle(thread.title)
        .navigationBarTitleDisplayMode(.inline)
        .alert("Error", isPresented: .init(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .task {
            await loadMessages()
            await connectWebSocket()
        }
        .onDisappear {
            wsTask?.cancel(with: .normalClosure, reason: nil)
        }
    }

    private func loadMessages() async {
        guard let client = session.apiClient else { return }
        do {
            messages = try await client.getMessages(threadId: thread.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func sendMessage() async {
        guard let client = session.apiClient else { return }
        let body = newMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }

        isSending = true
        newMessage = ""

        do {
            let sent = try await client.sendMessage(threadId: thread.id, body: body)
            messages.append(sent)
        } catch {
            errorMessage = "Failed to send: \(error.localizedDescription)"
            newMessage = body // Restore message on failure
        }

        isSending = false
    }

    private func connectWebSocket() async {
        guard let client = session.apiClient else { return }
        guard let task = await client.connectWebSocket() else {
            connectionStatus = "Disconnected"
            return
        }
        wsTask = task
        connectionStatus = "Connected"

        // Listen for messages until cancelled
        while !Task.isCancelled {
            do {
                let wsMessage = try await task.receive()
                switch wsMessage {
                case .string(let text):
                    if let data = text.data(using: .utf8),
                       let event = try? JSONDecoder().decode(WSEvent.self, from: data) {
                        await handleWSEvent(event, raw: data)
                    }
                case .data(let data):
                    if let event = try? JSONDecoder().decode(WSEvent.self, from: data) {
                        await handleWSEvent(event, raw: data)
                    }
                @unknown default:
                    break
                }
            } catch {
                connectionStatus = "Disconnected"
                break
            }
        }
    }

    @MainActor
    private func handleWSEvent(_ event: WSEvent, raw: Data) {
        switch event.type {
        case "message.created":
            // Try to decode the message from the event data
            if let msgData = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
               let dataDict = msgData["data"] as? [String: Any],
               let dataJSON = try? JSONSerialization.data(withJSONObject: dataDict),
               let message = try? JSONDecoder().decode(Message.self, from: dataJSON) {
                // Only add if it belongs to this thread and isn't already in the list
                if message.threadId == thread.id && !messages.contains(where: { $0.id == message.id }) {
                    messages.append(message)
                }
            }
        case "message.acked":
            if let msgData = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
               let dataDict = msgData["data"] as? [String: Any],
               let msgId = dataDict["id"] as? String,
               let dataJSON = try? JSONSerialization.data(withJSONObject: dataDict),
               let updated = try? JSONDecoder().decode(Message.self, from: dataJSON) {
                if let idx = messages.firstIndex(where: { $0.id == msgId }) {
                    messages[idx] = updated
                }
            }
        case "connection.changed":
            if let dataDict = (event.data?.value as? [String: Any]),
               let status = dataDict["status"] as? String {
                connectionStatus = status == "connected" ? "Connected" : status
            }
        default:
            break
        }
    }
}

// MARK: - Message Bubble

struct MessageBubble: View {
    let message: Message

    var isUser: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                Text(message.body)
                    .padding(12)
                    .background(isUser ? Color.accentColor : Color(.systemGray5))
                    .foregroundColor(isUser ? .white : .primary)
                    .clipShape(RoundedRectangle(cornerRadius: 16))

                HStack(spacing: 4) {
                    switch message.state {
                    case .pending:
                        Image(systemName: "clock")
                            .font(.caption2)
                    case .sent:
                        Image(systemName: "checkmark")
                            .font(.caption2)
                    case .acked:
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption2)
                    case .failed:
                        Image(systemName: "exclamationmark.circle")
                            .font(.caption2)
                            .foregroundColor(.red)
                    }
                    Text(message.source.rawValue)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            if !isUser { Spacer(minLength: 40) }
        }
    }
}
