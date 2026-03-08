'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Runs a git command in the specified directory and returns trimmed output.
 * Returns null if the command fails.
 * Uses execFileSync with array args to prevent command injection.
 */
function gitCommand(repoPath, args) {
  try {
    return execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Checks if a directory is a git repository.
 */
function isGitRepo(dirPath) {
  return gitCommand(dirPath, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

/**
 * Extracts git metadata from a repository path.
 */
function getGitMetadata(repoPath) {
  if (!isGitRepo(repoPath)) {
    return null;
  }

  const repoName = path.basename(repoPath);
  const currentBranch = gitCommand(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const lastCommitHash = gitCommand(repoPath, ['rev-parse', '--short', 'HEAD']);
  const lastCommitFullHash = gitCommand(repoPath, ['rev-parse', 'HEAD']);
  const remoteUrl = gitCommand(repoPath, ['config', '--get', 'remote.origin.url']);

  // Get changed files count
  const statusOutput = gitCommand(repoPath, ['status', '--porcelain']);
  const changedFiles = statusOutput ? statusOutput.split('\n').filter(line => line.trim()).length : 0;

  // Get recently modified tracked files (last 10)
  const recentFilesRaw = gitCommand(repoPath, ['diff', '--name-only', 'HEAD~1', 'HEAD']) ||
    gitCommand(repoPath, ['diff', '--name-only', '--cached']) || '';
  const recentFiles = recentFilesRaw.split('\n').filter(f => f.trim()).slice(0, 10);

  // Get last commit message
  const lastCommitMessage = gitCommand(repoPath, ['log', '-1', '--pretty=format:%s']);

  // Get last commit timestamp
  const lastCommitTime = gitCommand(repoPath, ['log', '-1', '--pretty=format:%aI']);

  return {
    repo_name: repoName,
    current_branch: currentBranch,
    last_commit_hash: lastCommitHash,
    last_commit_full_hash: lastCommitFullHash,
    git_remote_url: remoteUrl,
    changed_files_count: changedFiles,
    recent_files: recentFiles,
    last_commit_message: lastCommitMessage,
    last_commit_time: lastCommitTime
  };
}

/**
 * Scans a directory for projects (directories that are git repos).
 * Uses a shallow scan (1 level deep) by default.
 */
function scanForProjects(basePath, { maxDepth = 1 } = {}) {
  const projects = [];

  if (!fs.existsSync(basePath)) {
    return projects;
  }

  // Check if basePath itself is a git repo
  if (isGitRepo(basePath)) {
    const meta = getGitMetadata(basePath);
    if (meta) {
      projects.push({
        name: meta.repo_name,
        local_path: basePath,
        ...meta
      });
    }
  }

  if (maxDepth > 0) {
    try {
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const childPath = path.join(basePath, entry.name);
          if (isGitRepo(childPath)) {
            const meta = getGitMetadata(childPath);
            if (meta) {
              projects.push({
                name: meta.repo_name,
                local_path: childPath,
                ...meta
              });
            }
          }
        }
      }
    } catch {
      // Permission denied or other FS error
    }
  }

  return projects;
}

module.exports = {
  isGitRepo,
  getGitMetadata,
  scanForProjects
};
