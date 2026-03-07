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
}
