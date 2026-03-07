import Foundation

/// API client for communicating with the Cursor Mobile Companion server.
public final class CompanionAPIClient: Sendable {
    private let baseURL: URL
    private let session: URLSession

    /// Thread-safe storage for session token using an actor.
    private let tokenStorage = TokenStorage()

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    // MARK: - Token Management

    public func setSessionToken(_ token: String) async {
        await tokenStorage.set(token)
    }

    public func getSessionToken() async -> String? {
        return await tokenStorage.get()
    }

    public func clearSessionToken() async {
        await tokenStorage.clear()
    }

    // MARK: - Pairing

    public func startPairing(deviceName: String) async throws -> PairStartResponse {
        let body = PairStartRequest(deviceName: deviceName)
        return try await post("/api/pair/start", body: body, authenticated: false)
    }

    public func confirmPairing(deviceId: String, pairingToken: String) async throws -> PairConfirmResponse {
        let body = PairConfirmRequest(deviceId: deviceId, pairingToken: pairingToken)
        let response: PairConfirmResponse = try await post("/api/pair/confirm", body: body, authenticated: false)
        await setSessionToken(response.sessionToken)
        return response
    }

    // MARK: - Projects

    public func getProjects() async throws -> [Project] {
        return try await get("/api/projects")
    }

    public func getProject(id: String) async throws -> Project {
        return try await get("/api/projects/\(id)")
    }

    public func scanProjects(path: String) async throws -> ScanResult {
        struct Body: Codable { let scan_path: String }
        return try await post("/api/projects/scan", body: Body(scan_path: path))
    }

    public func createProject(name: String, localPath: String, gitRemoteUrl: String? = nil, currentBranch: String? = nil, lastCommitHash: String? = nil) async throws -> Project {
        struct Body: Codable { let name: String; let local_path: String; let git_remote_url: String?; let current_branch: String?; let last_commit_hash: String? }
        return try await post("/api/projects", body: Body(name: name, local_path: localPath, git_remote_url: gitRemoteUrl, current_branch: currentBranch, last_commit_hash: lastCommitHash))
    }

    public func updateProject(id: String, name: String? = nil, localPath: String? = nil, gitRemoteUrl: String? = nil, currentBranch: String? = nil) async throws -> Project {
        var fields: [String: String] = [:]
        if let name = name { fields["name"] = name }
        if let localPath = localPath { fields["local_path"] = localPath }
        if let gitRemoteUrl = gitRemoteUrl { fields["git_remote_url"] = gitRemoteUrl }
        if let currentBranch = currentBranch { fields["current_branch"] = currentBranch }
        return try await put("/api/projects/\(id)", body: fields)
    }

    public func deleteProject(id: String) async throws {
        let _: DeleteResponse = try await delete("/api/projects/\(id)")
    }

    // MARK: - Threads

    public func getThreads(projectId: String) async throws -> [ConversationThread] {
        return try await get("/api/threads?project_id=\(projectId)")
    }

    public func getThread(id: String) async throws -> ConversationThread {
        return try await get("/api/threads/\(id)")
    }

    public func createThread(projectId: String, title: String) async throws -> ConversationThread {
        struct Body: Codable { let project_id: String; let title: String }
        return try await post("/api/threads", body: Body(project_id: projectId, title: title))
    }

    public func updateThread(id: String, title: String? = nil, status: String? = nil) async throws -> ConversationThread {
        var fields: [String: String] = [:]
        if let title = title { fields["title"] = title }
        if let status = status { fields["status"] = status }
        return try await put("/api/threads/\(id)", body: fields)
    }

    public func deleteThread(id: String) async throws {
        let _: DeleteResponse = try await delete("/api/threads/\(id)")
    }

    // MARK: - Messages

    public func getMessages(threadId: String, limit: Int = 100) async throws -> [Message] {
        return try await get("/api/messages?thread_id=\(threadId)&limit=\(limit)")
    }

    public func sendMessage(threadId: String, role: String = "user", body: String) async throws -> Message {
        struct Body: Codable { let thread_id: String; let role: String; let body: String }
        return try await post("/api/messages", body: Body(thread_id: threadId, role: role, body: body))
    }

    public func acknowledgeMessage(messageId: String) async throws -> Message {
        struct Body: Codable { let message_id: String }
        return try await post("/api/ack", body: Body(message_id: messageId))
    }

    // MARK: - Devices

    public func getDevices() async throws -> [Device] {
        return try await get("/api/devices")
    }

    public func revokeDevice(id: String) async throws {
        let _: DeleteResponse = try await delete("/api/devices/\(id)")
    }

    // MARK: - Status

    public func getStatus() async throws -> ServerStatus {
        return try await get("/api/status", authenticated: false)
    }

    // MARK: - WebSocket

    /// Creates a URLSessionWebSocketTask for real-time sync.
    public func connectWebSocket() async -> URLSessionWebSocketTask? {
        guard let token = await getSessionToken() else { return nil }
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.path = "/ws"
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        // Switch scheme to ws/wss
        if components.scheme == "http" { components.scheme = "ws" }
        else if components.scheme == "https" { components.scheme = "wss" }
        guard let wsURL = components.url else { return nil }
        let task = session.webSocketTask(with: wsURL)
        task.resume()
        return task
    }

    // MARK: - Private Helpers

    private func get<T: Decodable>(_ path: String, authenticated: Bool = true) async throws -> T {
        let url = buildURL(path)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        if authenticated, let token = await getSessionToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B, authenticated: Bool = true) async throws -> T {
        let url = buildURL(path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        if authenticated, let token = await getSessionToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func put<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let url = buildURL(path)
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)

        if let token = await getSessionToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func delete<T: Decodable>(_ path: String) async throws -> T {
        let url = buildURL(path)
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"

        if let token = await getSessionToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func buildURL(_ path: String) -> URL {
        // Handle paths that already contain query parameters
        if path.contains("?") {
            var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
            let parts = path.split(separator: "?", maxSplits: 1)
            components.path = String(parts[0])
            components.query = parts.count > 1 ? String(parts[1]) : nil
            return components.url!
        }
        return baseURL.appendingPathComponent(path)
    }

    private func validateResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw CompanionAPIError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw CompanionAPIError.httpError(statusCode: httpResponse.statusCode)
        }
    }
}

// MARK: - Token Storage Actor

private actor TokenStorage {
    private var token: String?

    func set(_ token: String) {
        self.token = token
    }

    func get() -> String? {
        return token
    }

    func clear() {
        self.token = nil
    }
}

// MARK: - Errors

public enum CompanionAPIError: Error, LocalizedError {
    case invalidResponse
    case httpError(statusCode: Int)
    case decodingError(Error)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Invalid response from server"
        case .httpError(let code): return "HTTP error: \(code)"
        case .decodingError(let error): return "Decoding error: \(error.localizedDescription)"
        }
    }
}
