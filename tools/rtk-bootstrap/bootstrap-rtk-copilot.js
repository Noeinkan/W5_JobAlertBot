#!/usr/bin/env node

/**
 * RTK Copilot repo bootstrap
 *
 * Creates the repo-local GitHub Copilot RTK files in a target repository.
 * This intentionally uses RTK's `--no-patch` mode so it does not touch any
 * global editor settings while bootstrapping another repo.
 *
 * Usage:
 *   node bootstrap-rtk-copilot.js
 *   node bootstrap-rtk-copilot.js ../other-repo
 *   node bootstrap-rtk-copilot.js ../other-repo --force
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const help = args.includes('--help') || args.includes('-h');
  const positional = args.filter(arg => !arg.startsWith('--') && arg !== '-h');

  if (positional.length > 1) {
    console.error('Usage: node bootstrap-rtk-copilot.js [target-dir] [--force]');
    process.exit(1);
  }

  return {
    force,
    help,
    targetDir: positional[0] || process.cwd()
  };
}

function printHelp() {
  console.log(`RTK Copilot repo bootstrap

Usage:
  node bootstrap-rtk-copilot.js
  node bootstrap-rtk-copilot.js ../other-repo
  node bootstrap-rtk-copilot.js ../other-repo --force

Options:
  --force    Replace existing Copilot RTK files in the target repo
  -h, --help Show this help message
`);
}

function resolveRtkBinary() {
  const candidates = [];

  if (process.env.RTK_BIN) {
    candidates.push(process.env.RTK_BIN);
  }

  candidates.push('rtk');

  if (process.platform === 'win32' && process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, '.local', 'bin', 'rtk.exe'));
  }

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], {
      stdio: 'ignore',
      shell: false
    });

    if (result.status === 0) {
      return candidate;
    }
  }

  return null;
}

function ensureTargetRepo(targetDir) {
  if (!fs.existsSync(targetDir)) {
    console.error(`Target directory does not exist: ${targetDir}`);
    process.exit(1);
  }

  const stats = fs.statSync(targetDir);
  if (!stats.isDirectory()) {
    console.error(`Target path is not a directory: ${targetDir}`);
    process.exit(1);
  }
}

function getManagedPaths(targetDir) {
  return {
    hookPath: path.join(targetDir, '.github', 'hooks', 'rtk-rewrite.json'),
    instructionsPath: path.join(targetDir, '.github', 'copilot-instructions.md')
  };
}

function handleExistingFiles(paths, force) {
  const existing = Object.values(paths).filter(filePath => fs.existsSync(filePath));

  if (!existing.length) {
    return;
  }

  if (!force) {
    console.error('Refusing to overwrite existing RTK Copilot files:');
    for (const filePath of existing) {
      console.error(`  - ${filePath}`);
    }
    console.error('Re-run with --force to replace them.');
    process.exit(1);
  }

  for (const filePath of existing) {
    fs.rmSync(filePath, { force: true });
  }
}

function runBootstrap(rtkBinary, targetDir) {
  const result = spawnSync(
    rtkBinary,
    ['init', '-g', '--copilot', '--no-patch'],
    {
      cwd: targetDir,
      stdio: 'inherit',
      shell: false
    }
  );

  if (result.error) {
    console.error(`Failed to run RTK: ${result.error.message}`);
    process.exit(1);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

function verifyOutput(paths) {
  const missing = Object.values(paths).filter(filePath => !fs.existsSync(filePath));

  if (missing.length) {
    console.error('RTK completed but expected files were not created:');
    for (const filePath of missing) {
      console.error(`  - ${filePath}`);
    }
    process.exit(1);
  }
}

function main() {
  const { force, help, targetDir } = parseArgs();

  if (help) {
    printHelp();
    return;
  }

  const absoluteTargetDir = path.resolve(targetDir);
  ensureTargetRepo(absoluteTargetDir);

  const rtkBinary = resolveRtkBinary();
  if (!rtkBinary) {
    console.error('Could not find RTK. Install it first or set RTK_BIN to the executable path.');
    process.exit(1);
  }

  const managedPaths = getManagedPaths(absoluteTargetDir);
  handleExistingFiles(managedPaths, force);
  runBootstrap(rtkBinary, absoluteTargetDir);
  verifyOutput(managedPaths);

  console.log('');
  console.log(`RTK Copilot bootstrap complete for: ${absoluteTargetDir}`);
  console.log(`  Hook: ${managedPaths.hookPath}`);
  console.log(`  Instructions: ${managedPaths.instructionsPath}`);
  console.log('  Restart VS Code or reload Copilot after opening the target repo.');
}

main();