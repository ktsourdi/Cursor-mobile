'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { isGitRepo, getGitMetadata, scanForProjects } = require('../src/project-discovery/git');

describe('Project Discovery - Git', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-discovery-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createGitRepo(dir, name) {
    const repoPath = path.join(dir, name);
    fs.mkdirSync(repoPath, { recursive: true });
    execSync('git init', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test');
    execSync('git add .', { cwd: repoPath, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: repoPath, stdio: 'pipe' });
    return repoPath;
  }

  describe('isGitRepo', () => {
    it('should return true for a git repo', () => {
      const repoPath = createGitRepo(tmpDir, 'testrepo');
      assert.equal(isGitRepo(repoPath), true);
    });

    it('should return false for a non-git directory', () => {
      const dir = path.join(tmpDir, 'notrepo');
      fs.mkdirSync(dir);
      assert.equal(isGitRepo(dir), false);
    });

    it('should return false for a non-existent directory', () => {
      assert.equal(isGitRepo(path.join(tmpDir, 'nonexistent')), false);
    });
  });

  describe('getGitMetadata', () => {
    it('should extract metadata from a git repo', () => {
      const repoPath = createGitRepo(tmpDir, 'myproject');
      const meta = getGitMetadata(repoPath);

      assert.ok(meta);
      assert.equal(meta.repo_name, 'myproject');
      assert.ok(meta.current_branch);
      assert.ok(meta.last_commit_hash);
      assert.equal(meta.last_commit_message, 'initial');
      assert.equal(typeof meta.changed_files_count, 'number');
    });

    it('should return null for non-git directory', () => {
      const dir = path.join(tmpDir, 'notgit');
      fs.mkdirSync(dir);
      const meta = getGitMetadata(dir);
      assert.equal(meta, null);
    });

    it('should detect changed files', () => {
      const repoPath = createGitRepo(tmpDir, 'changes');
      fs.writeFileSync(path.join(repoPath, 'new-file.txt'), 'content');
      const meta = getGitMetadata(repoPath);
      assert.equal(meta.changed_files_count, 1);
    });
  });

  describe('scanForProjects', () => {
    it('should find git repos in a directory', () => {
      createGitRepo(tmpDir, 'project-a');
      createGitRepo(tmpDir, 'project-b');
      fs.mkdirSync(path.join(tmpDir, 'not-a-repo'));

      const projects = scanForProjects(tmpDir);
      const names = projects.map(p => p.name);
      assert.ok(names.includes('project-a'));
      assert.ok(names.includes('project-b'));
    });

    it('should return empty for non-existent path', () => {
      const projects = scanForProjects('/nonexistent/path');
      assert.equal(projects.length, 0);
    });

    it('should detect the base path itself as a project', () => {
      const repoPath = createGitRepo(tmpDir, 'singlerepo');
      const projects = scanForProjects(repoPath);
      assert.equal(projects.length, 1);
      assert.equal(projects[0].name, 'singlerepo');
    });
  });
});
