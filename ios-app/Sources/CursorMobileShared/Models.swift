import Foundation

// MARK: - Device

/// Represents a paired device in the system.
public struct Device: Codable, Identifiable, Sendable {
    public let id: String
    public let deviceName: String
    public let platform: DevicePlatform
    public let trustedAt: String?
    public let revokedAt: String?

    public enum DevicePlatform: String, Codable, Sendable {
        case mac
        case iphone
    }

    enum CodingKeys: String, CodingKey {
        case id
        case deviceName = "device_name"
        case platform
        case trustedAt = "trusted_at"
        case revokedAt = "revoked_at"
    }
}

// MARK: - Project

/// Represents a project detected by the Mac companion.
public struct Project: Codable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let localPath: String
    public let gitRemoteUrl: String?
    public let currentBranch: String?
    public let lastCommitHash: String?
    public let lastActiveAt: String
    public let git: GitMetadata?

    enum CodingKeys: String, CodingKey {
        case id, name, git
        case localPath = "local_path"
        case gitRemoteUrl = "git_remote_url"
        case currentBranch = "current_branch"
        case lastCommitHash = "last_commit_hash"
        case lastActiveAt = "last_active_at"
    }
}

/// Git metadata enrichment for a project.
public struct GitMetadata: Codable, Sendable {
    public let repoName: String?
    public let currentBranch: String?
    public let lastCommitHash: String?
    public let lastCommitFullHash: String?
    public let gitRemoteUrl: String?
    public let changedFilesCount: Int?
    public let recentFiles: [String]?
    public let lastCommitMessage: String?
    public let lastCommitTime: String?

    enum CodingKeys: String, CodingKey {
        case repoName = "repo_name"
        case currentBranch = "current_branch"
        case lastCommitHash = "last_commit_hash"
        case lastCommitFullHash = "last_commit_full_hash"
        case gitRemoteUrl = "git_remote_url"
        case changedFilesCount = "changed_files_count"
        case recentFiles = "recent_files"
        case lastCommitMessage = "last_commit_message"
        case lastCommitTime = "last_commit_time"
    }
}

// MARK: - Thread

/// Represents a conversation thread within a project.
public struct ConversationThread: Codable, Identifiable, Sendable {
    public let id: String
    public let projectId: String
    public let title: String
    public let createdAt: String
    public let updatedAt: String
    public let originType: OriginType
    public let status: ThreadStatus

    public enum OriginType: String, Codable, Sendable {
        case sidecar
        case imported
        case manual
    }

    public enum ThreadStatus: String, Codable, Sendable {
        case active
        case archived
    }

    enum CodingKeys: String, CodingKey {
        case id, title, status
        case projectId = "project_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case originType = "origin_type"
    }
}

// MARK: - Message

/// Represents a message within a thread.
public struct Message: Codable, Identifiable, Sendable {
    public let id: String
    public let threadId: String
    public let role: MessageRole
    public let body: String
    public let createdAt: String
    public let deviceId: String?
    public let source: MessageSource
    public let state: MessageState

    public enum MessageRole: String, Codable, Sendable {
        case user
        case system
        case assistant
        case tool
    }

    public enum MessageSource: String, Codable, Sendable {
        case mac
        case mobile
        case imported
    }

    public enum MessageState: String, Codable, Sendable {
        case pending
        case sent
        case acked
        case failed
    }

    enum CodingKeys: String, CodingKey {
        case id, role, body, source, state
        case threadId = "thread_id"
        case createdAt = "created_at"
        case deviceId = "device_id"
    }
}

// MARK: - Pairing

/// Request to start device pairing.
public struct PairStartRequest: Codable, Sendable {
    public let deviceName: String
    public let platform: String

    public init(deviceName: String, platform: String = "iphone") {
        self.deviceName = deviceName
        self.platform = platform
    }

    enum CodingKeys: String, CodingKey {
        case deviceName = "device_name"
        case platform
    }
}

/// Response from starting device pairing.
public struct PairStartResponse: Codable, Sendable {
    public let deviceId: String
    public let pairingToken: String
    public let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case deviceId = "device_id"
        case pairingToken = "pairing_token"
        case expiresAt = "expires_at"
    }
}

/// Request to confirm device pairing.
public struct PairConfirmRequest: Codable, Sendable {
    public let deviceId: String
    public let pairingToken: String

    public init(deviceId: String, pairingToken: String) {
        self.deviceId = deviceId
        self.pairingToken = pairingToken
    }

    enum CodingKeys: String, CodingKey {
        case deviceId = "device_id"
        case pairingToken = "pairing_token"
    }
}

/// Response from confirming device pairing.
public struct PairConfirmResponse: Codable, Sendable {
    public let sessionToken: String
    public let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case sessionToken = "session_token"
        case expiresAt = "expires_at"
    }
}

// MARK: - WebSocket Events

/// WebSocket event wrapper.
public struct WSEvent: Codable, Sendable {
    public let type: String
    public let data: AnyCodable?
}

/// Type-erased Codable wrapper for JSON data.
public struct AnyCodable: Codable, Sendable {
    public let value: Any

    public init(_ value: Any) {
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues { $0.value }
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if container.decodeNil() {
            value = NSNull()
        } else {
            throw DecodingError.typeMismatch(AnyCodable.self,
                DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Unsupported type"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let string as String: try container.encode(string)
        case let int as Int: try container.encode(int)
        case let double as Double: try container.encode(double)
        case let bool as Bool: try container.encode(bool)
        case is NSNull: try container.encodeNil()
        default: try container.encodeNil()
        }
    }
}

// MARK: - Server Status

/// Server status response.
public struct ServerStatus: Codable, Sendable {
    public let status: String
    public let version: String
    public let connectedDevices: Int
    public let projectCount: Int

    enum CodingKeys: String, CodingKey {
        case status, version
        case connectedDevices = "connected_devices"
        case projectCount = "project_count"
    }
}
