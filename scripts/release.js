#!/usr/bin/env node
'use strict';
/**
 * Interactive release script for geotab-smart-sdk.
 *
 * Runs every pre-flight gate, asks for the version bump and dist-tag, shows
 * a final preview, then bumps + publishes + tags + pushes — with a clean
 * rollback if `npm publish` fails (the version bump is reverted in package.json).
 *
 * Usage:
 *   npm run release            # full flow
 *   npm run release -- --dry-run   # everything except the actual publish
 */

const { execSync, spawnSync } = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs');

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Tiny terminal helpers (no deps) ──────────────────────────────────────
const useColor = process.stdout.isTTY;
const ansi = (code) => (s) => useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
const c = {
  bold:   ansi('1'),
  dim:    ansi('2'),
  red:    ansi('31'),
  green:  ansi('32'),
  yellow: ansi('33'),
  cyan:   ansi('36'),
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

const out  = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const run  = (cmd) => execSync(cmd, { stdio: 'inherit' });
const step = (msg) => console.log(`\n${c.cyan('▸')} ${msg}`);
const ok   = (msg) => console.log(`  ${c.green('✓')} ${msg}`);
const note = (msg) => console.log(`  ${c.dim(msg)}`);
const fail = (msg) => { throw new Error(msg); };

// ─── Version helpers ──────────────────────────────────────────────────────
function bump(version, type) {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Cannot parse version: ${version}`);
  let [, major, minor, patch] = m.map(Number);
  if (type === 'major')      { major++; minor = 0; patch = 0; }
  else if (type === 'minor') { minor++; patch = 0; }
  else if (type === 'patch') { patch++; }
  return `${major}.${minor}.${patch}`;
}

function isValidVersion(v) {
  return /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/i.test(v);
}

// ─── Main flow ────────────────────────────────────────────────────────────
async function main() {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  console.log(c.bold(`\n${pkg.name} release  ${DRY_RUN ? c.yellow('(dry run)') : ''}\n`));

  // 1. npm auth
  step('Checking npm auth');
  let npmUser;
  try {
    npmUser = out('npm whoami');
  } catch {
    fail('Not logged in to npm. Run `npm login` first.');
  }
  ok(`Authenticated as "${npmUser}"`);

  // 2. Branch + clean tree
  step('Checking git status');
  const branch = out('git rev-parse --abbrev-ref HEAD');
  if (branch !== 'main') {
    const proceed = await ask(
      `  ${c.yellow('!')} You're on "${branch}", not "main". Continue? [y/N] `
    );
    if (proceed.trim().toLowerCase() !== 'y') fail('Aborted.');
  }
  const dirty = out('git status --porcelain');
  if (dirty) {
    console.error(c.dim('  Uncommitted changes:'));
    console.error(dirty.split('\n').map((l) => '    ' + l).join('\n'));
    fail('Working tree is not clean. Commit or stash first.');
  }
  ok(`Branch "${branch}" is clean`);

  // 3. Tests
  step('Running smoke tests');
  if (spawnSync('npm', ['test'], { stdio: 'inherit' }).status !== 0) {
    fail('Tests failed.');
  }
  ok('Tests passed');

  // 4. Lint
  step('Running lint');
  if (spawnSync('npm', ['run', 'lint'], { stdio: 'inherit' }).status !== 0) {
    fail('Lint failed.');
  }
  ok('Lint clean');

  // 5. Pack preview
  step('Verifying package contents');
  const packJson = JSON.parse(execSync('npm pack --dry-run --json', { encoding: 'utf8' }))[0];
  ok(`${packJson.entryCount} files · ${(packJson.size / 1024).toFixed(1)} kB packed`);
  for (const f of packJson.files.slice(0, 10)) note(`· ${f.path}`);
  if (packJson.files.length > 10) note(`· … and ${packJson.files.length - 10} more`);

  // 6. Version bump
  console.log(`\n  ${c.bold('Current version:')} ${pkg.version}`);
  console.log('  Bump:');
  console.log(`    ${c.bold('1)')} patch   ${pkg.version} → ${bump(pkg.version, 'patch')}`);
  console.log(`    ${c.bold('2)')} minor   ${pkg.version} → ${bump(pkg.version, 'minor')}`);
  console.log(`    ${c.bold('3)')} major   ${pkg.version} → ${bump(pkg.version, 'major')}`);
  console.log(`    ${c.bold('4)')} custom  (e.g. 0.2.0-beta.1)`);
  const choice = (await ask('  Choose [1-4]: ')).trim();

  let newVersion;
  switch (choice) {
    case '1': newVersion = bump(pkg.version, 'patch'); break;
    case '2': newVersion = bump(pkg.version, 'minor'); break;
    case '3': newVersion = bump(pkg.version, 'major'); break;
    case '4':
      newVersion = (await ask('  Enter version: ')).trim();
      if (!isValidVersion(newVersion)) fail(`Invalid semver: ${newVersion}`);
      break;
    default:
      fail('Invalid choice.');
  }

  // 7. Dist-tag
  const isPrerelease = newVersion.includes('-');
  const defaultTag = isPrerelease ? 'next' : 'latest';
  const tagInput = (await ask(`  Dist-tag [${defaultTag}]: `)).trim();
  const distTag = tagInput || defaultTag;

  // 8. Final confirm
  console.log(`\n  ${c.bold('Ready to release')}`);
  console.log(`    Version:    ${pkg.version} → ${c.bold(newVersion)}`);
  console.log(`    Dist-tag:   ${distTag}`);
  console.log(`    npm user:   ${npmUser}`);
  console.log(`    Branch:     ${branch}`);
  if (DRY_RUN) console.log(`    Dry run:    ${c.yellow('YES — nothing will be published')}`);
  const final = (await ask(`\n  Proceed? [y/N] `)).trim().toLowerCase();
  if (final !== 'y') fail('Aborted.');

  // 9. Bump (file only — commit happens after successful publish)
  step(`Bumping package.json to ${newVersion}`);
  run(`npm version ${newVersion} --no-git-tag-version --allow-same-version`);
  ok('Bumped');

  // 10. Publish (with rollback on failure)
  step('Publishing to npm');
  if (DRY_RUN) {
    note('(dry run — skipping `npm publish`)');
  } else {
    try {
      run(`npm publish --tag ${distTag}`);
    } catch (err) {
      console.error(`\n  ${c.red('✗')} npm publish failed. Rolling back version bump.`);
      try {
        run('git checkout -- package.json');
        if (fs.existsSync('package-lock.json')) run('git checkout -- package-lock.json');
      } catch (rollbackErr) {
        console.error(`  ${c.red('!')} Rollback failed: ${rollbackErr.message}`);
        console.error('  Manually undo with: git checkout -- package.json package-lock.json');
      }
      fail('Publish failed; version reverted.');
    }
  }
  ok(DRY_RUN ? 'Would have published' : 'Published');

  // 11. Commit + tag + push
  step('Committing release + tagging');
  if (DRY_RUN) {
    note('(dry run — skipping commit, tag, push)');
    run('git checkout -- package.json');
    if (fs.existsSync('package-lock.json')) run('git checkout -- package-lock.json');
  } else {
    run(`git commit -am "Release v${newVersion}"`);
    run(`git tag -a v${newVersion} -m "Release v${newVersion}"`);
    run('git push --follow-tags');
  }
  ok('Done');

  // 12. Summary
  console.log(`\n${c.green('✓')} ${c.bold(`${pkg.name}@${newVersion}`)} ${DRY_RUN ? '(dry run complete)' : 'is live!'}\n`);
  if (!DRY_RUN) {
    console.log(`  ${c.dim('npm:')}    https://www.npmjs.com/package/${pkg.name}`);
    if (pkg.repository?.url) {
      const repoUrl = pkg.repository.url
        .replace(/^git\+/, '')
        .replace(/\.git$/, '');
      console.log(`  ${c.dim('git:')}    ${repoUrl}/releases/tag/v${newVersion}`);
    }
    console.log();
  }
}

main()
  .catch((err) => {
    console.error(`\n${c.red('✗')} ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
