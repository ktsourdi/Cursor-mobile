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

    // MARK: - Threads

    public func getThreads(projectId: String) async throws -> [ConversationThread] {
        return try await get("/api/threads?project_id=\(projectId)")
    }

    public func createThread(projectId: String, title: String) async throws -> ConversationThread {
        struct Body: Codable { let project_id: String; let title: String }
        return try await post("/api/threads", body: Body(project_id: projectId, title: title))
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

    // MARK: - Status

    public func getStatus() async throws -> ServerStatus {
        return try await get("/api/status", authenticated: false)
    }

    // MARK: - Private Helpers

    private func get<T: Decodable>(_ path: String, authenticated: Bool = true) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "GET"

        if authenticated, let token = await getSessionToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        try validateResponse(response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B, authenticated: Bool = true) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
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
