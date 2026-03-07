import SwiftUI

/// Main entry point for the Cursor Mobile iPhone app.
@main
struct CursorMobileAppMain: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

/// Root content view that handles navigation based on pairing state.
struct ContentView: View {
    @State private var isPaired = false

    var body: some View {
        NavigationStack {
            if isPaired {
                ProjectListView()
            } else {
                PairDeviceView(isPaired: $isPaired)
            }
        }
    }
}

// MARK: - Pair Device View

struct PairDeviceView: View {
    @Binding var isPaired: Bool
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
                .padding(.horizontal)

            TextField("Pairing Code", text: $pairingCode)
                .textFieldStyle(.roundedBorder)
                .autocapitalization(.none)
                .padding(.horizontal)

            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            }

            Button(action: { /* Pairing logic handled by API client */ }) {
                if isConnecting {
                    ProgressView()
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
}

// MARK: - Project List View

struct ProjectListView: View {
    @State private var projects: [ProjectItem] = []

    var body: some View {
        List(projects) { project in
            NavigationLink(destination: ThreadListView(projectId: project.id, projectName: project.name)) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(project.name)
                        .font(.headline)
                    if let branch = project.branch {
                        Label(branch, systemImage: "arrow.triangle.branch")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .navigationTitle("Projects")
        .overlay {
            if projects.isEmpty {
                ContentUnavailableView(
                    "No Projects",
                    systemImage: "folder",
                    description: Text("Projects detected by the Mac companion will appear here.")
                )
            }
        }
    }
}

// MARK: - Thread List View

struct ThreadListView: View {
    let projectId: String
    let projectName: String
    @State private var threads: [ThreadItem] = []

    var body: some View {
        List(threads) { thread in
            NavigationLink(destination: ThreadDetailView(threadId: thread.id, threadTitle: thread.title)) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(thread.title)
                        .font(.headline)
                    Text(thread.updatedAt)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 4)
            }
        }
        .navigationTitle(projectName)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: {}) {
                    Image(systemName: "plus")
                }
            }
        }
    }
}

// MARK: - Thread Detail View

struct ThreadDetailView: View {
    let threadId: String
    let threadTitle: String
    @State private var messages: [MessageItem] = []
    @State private var newMessage = ""
    @State private var connectionStatus = "Connected"

    var body: some View {
        VStack(spacing: 0) {
            // Connection status bar
            HStack {
                Circle()
                    .fill(connectionStatus == "Connected" ? .green : .red)
                    .frame(width: 8, height: 8)
                Text(connectionStatus)
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
            }
            .padding(.horizontal)
            .padding(.vertical, 4)

            // Messages
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(messages) { message in
                        MessageBubble(message: message)
                    }
                }
                .padding()
            }

            // Input bar
            HStack(spacing: 8) {
                TextField("Message...", text: $newMessage)
                    .textFieldStyle(.roundedBorder)

                Button(action: {}) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .disabled(newMessage.isEmpty)
            }
            .padding()
        }
        .navigationTitle(threadTitle)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Message Bubble

struct MessageBubble: View {
    let message: MessageItem

    var body: some View {
        HStack {
            if message.role == "user" { Spacer() }

            VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 4) {
                Text(message.body)
                    .padding(12)
                    .background(message.role == "user" ? Color.accentColor : Color(.systemGray5))
                    .foregroundColor(message.role == "user" ? .white : .primary)
                    .clipShape(RoundedRectangle(cornerRadius: 16))

                HStack(spacing: 4) {
                    if message.state == "pending" {
                        Image(systemName: "clock")
                            .font(.caption2)
                    } else if message.state == "sent" {
                        Image(systemName: "checkmark")
                            .font(.caption2)
                    } else if message.state == "acked" {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption2)
                    }
                    Text(message.source)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            if message.role != "user" { Spacer() }
        }
    }
}

// MARK: - Local View Models

struct ProjectItem: Identifiable {
    let id: String
    let name: String
    let branch: String?
}

struct ThreadItem: Identifiable {
    let id: String
    let title: String
    let updatedAt: String
}

struct MessageItem: Identifiable {
    let id: String
    let role: String
    let body: String
    let source: String
    let state: String
}
