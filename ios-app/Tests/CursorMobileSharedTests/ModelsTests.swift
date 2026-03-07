import XCTest
@testable import CursorMobileShared

final class ModelsTests: XCTestCase {

    // MARK: - Project Decoding

    func testProjectDecoding() throws {
        let json = """
        {
            "id": "proj-1",
            "name": "MyApp",
            "local_path": "/Users/dev/myapp",
            "git_remote_url": "https://github.com/user/myapp",
            "current_branch": "main",
            "last_commit_hash": "abc123",
            "last_active_at": "2025-01-01T00:00:00Z",
            "git": null
        }
        """.data(using: .utf8)!

        let project = try JSONDecoder().decode(Project.self, from: json)
        XCTAssertEqual(project.id, "proj-1")
        XCTAssertEqual(project.name, "MyApp")
        XCTAssertEqual(project.localPath, "/Users/dev/myapp")
        XCTAssertEqual(project.currentBranch, "main")
    }

    // MARK: - Thread Decoding

    func testThreadDecoding() throws {
        let json = """
        {
            "id": "thread-1",
            "project_id": "proj-1",
            "title": "Discussion",
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T01:00:00Z",
            "origin_type": "sidecar",
            "status": "active"
        }
        """.data(using: .utf8)!

        let thread = try JSONDecoder().decode(ConversationThread.self, from: json)
        XCTAssertEqual(thread.id, "thread-1")
        XCTAssertEqual(thread.title, "Discussion")
        XCTAssertEqual(thread.originType, .sidecar)
        XCTAssertEqual(thread.status, .active)
    }

    // MARK: - Message Decoding

    func testMessageDecoding() throws {
        let json = """
        {
            "id": "msg-1",
            "thread_id": "thread-1",
            "role": "user",
            "body": "Hello from mobile",
            "created_at": "2025-01-01T00:00:00Z",
            "device_id": "dev-1",
            "source": "mobile",
            "state": "sent"
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(Message.self, from: json)
        XCTAssertEqual(message.id, "msg-1")
        XCTAssertEqual(message.body, "Hello from mobile")
        XCTAssertEqual(message.role, .user)
        XCTAssertEqual(message.source, .mobile)
        XCTAssertEqual(message.state, .sent)
    }

    // MARK: - Pairing Request Encoding

    func testPairStartRequestEncoding() throws {
        let request = PairStartRequest(deviceName: "iPhone 15")
        let data = try JSONEncoder().encode(request)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(dict["device_name"] as? String, "iPhone 15")
        XCTAssertEqual(dict["platform"] as? String, "iphone")
    }

    // MARK: - Server Status Decoding

    func testServerStatusDecoding() throws {
        let json = """
        {
            "status": "ok",
            "version": "1.0.0",
            "connected_devices": 1,
            "project_count": 3
        }
        """.data(using: .utf8)!

        let status = try JSONDecoder().decode(ServerStatus.self, from: json)
        XCTAssertEqual(status.status, "ok")
        XCTAssertEqual(status.version, "1.0.0")
        XCTAssertEqual(status.connectedDevices, 1)
        XCTAssertEqual(status.projectCount, 3)
    }

    // MARK: - Device Decoding

    func testDeviceDecoding() throws {
        let json = """
        {
            "id": "dev-1",
            "device_name": "My iPhone",
            "platform": "iphone",
            "trusted_at": "2025-01-01T00:00:00Z",
            "revoked_at": null
        }
        """.data(using: .utf8)!

        let device = try JSONDecoder().decode(Device.self, from: json)
        XCTAssertEqual(device.id, "dev-1")
        XCTAssertEqual(device.deviceName, "My iPhone")
        XCTAssertEqual(device.platform, .iphone)
        XCTAssertEqual(device.trustedAt, "2025-01-01T00:00:00Z")
        XCTAssertNil(device.revokedAt)
    }

    // MARK: - GitMetadata Decoding

    func testGitMetadataDecoding() throws {
        let json = """
        {
            "repo_name": "my-app",
            "current_branch": "main",
            "last_commit_hash": "abc123",
            "last_commit_full_hash": "abc123def456",
            "git_remote_url": "https://github.com/user/my-app",
            "changed_files_count": 3,
            "recent_files": ["file1.swift", "file2.swift"],
            "last_commit_message": "Fix bug",
            "last_commit_time": "2025-01-01T00:00:00Z"
        }
        """.data(using: .utf8)!

        let meta = try JSONDecoder().decode(GitMetadata.self, from: json)
        XCTAssertEqual(meta.repoName, "my-app")
        XCTAssertEqual(meta.currentBranch, "main")
        XCTAssertEqual(meta.changedFilesCount, 3)
        XCTAssertEqual(meta.recentFiles?.count, 2)
        XCTAssertEqual(meta.lastCommitMessage, "Fix bug")
    }

    // MARK: - PairStartResponse Decoding

    func testPairStartResponseDecoding() throws {
        let json = """
        {
            "device_id": "dev-1",
            "pairing_token": "abc123",
            "expires_at": "2025-01-01T00:05:00Z"
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(PairStartResponse.self, from: json)
        XCTAssertEqual(response.deviceId, "dev-1")
        XCTAssertEqual(response.pairingToken, "abc123")
        XCTAssertEqual(response.expiresAt, "2025-01-01T00:05:00Z")
    }

    // MARK: - PairConfirmRequest Encoding

    func testPairConfirmRequestEncoding() throws {
        let request = PairConfirmRequest(deviceId: "dev-1", pairingToken: "abc123")
        let data = try JSONEncoder().encode(request)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(dict["device_id"] as? String, "dev-1")
        XCTAssertEqual(dict["pairing_token"] as? String, "abc123")
    }

    // MARK: - PairConfirmResponse Decoding

    func testPairConfirmResponseDecoding() throws {
        let json = """
        {
            "session_token": "session-abc-123",
            "expires_at": "2025-01-08T00:00:00Z"
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(PairConfirmResponse.self, from: json)
        XCTAssertEqual(response.sessionToken, "session-abc-123")
        XCTAssertEqual(response.expiresAt, "2025-01-08T00:00:00Z")
    }

    // MARK: - ScanResult Decoding

    func testScanResultDecoding() throws {
        let json = """
        {
            "scanned_path": "/Users/dev/projects",
            "discovered": 2,
            "projects": [
                {
                    "id": "proj-1",
                    "name": "my-app",
                    "local_path": "/Users/dev/projects/my-app",
                    "action": "created"
                }
            ]
        }
        """.data(using: .utf8)!

        let result = try JSONDecoder().decode(ScanResult.self, from: json)
        XCTAssertEqual(result.scannedPath, "/Users/dev/projects")
        XCTAssertEqual(result.discovered, 2)
        XCTAssertEqual(result.projects.count, 1)
        XCTAssertEqual(result.projects[0].name, "my-app")
        XCTAssertEqual(result.projects[0].action, "created")
    }

    // MARK: - DeleteResponse Decoding

    func testDeleteResponseDecoding() throws {
        let json = """
        {
            "status": "deleted"
        }
        """.data(using: .utf8)!

        let response = try JSONDecoder().decode(DeleteResponse.self, from: json)
        XCTAssertEqual(response.status, "deleted")
    }

    // MARK: - WSEvent Decoding

    func testWSEventDecoding() throws {
        let json = """
        {
            "type": "message.created",
            "data": {
                "id": "msg-1",
                "body": "Hello"
            }
        }
        """.data(using: .utf8)!

        let event = try JSONDecoder().decode(WSEvent.self, from: json)
        XCTAssertEqual(event.type, "message.created")
        XCTAssertNotNil(event.data)
    }
}
