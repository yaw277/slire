const { spawn } = require('child_process');
const { promisify } = require('util');
const sleep = promisify(setTimeout);

/**
 * Jest Global Setup for Firestore Emulator
 *
 * This automatically starts/stops the Firestore emulator for testing.
 *
 * Requirements:
 * - firebase-tools in devDependencies (in root package.json for Nx monorepo)
 * - Java 8+ installed (for Firestore emulator)
 *
 * CI Usage (GitHub Actions):
 * ```yaml
 * - uses: actions/setup-node@v4
 * - uses: actions/setup-java@v4
 *   with:
 *     java-version: '11'
 * - run: npm ci  # Installs firebase-tools from root package.json
 * - run: npx nx test smart-repo
 * ```
 */

let emulatorProcess = null;

async function startEmulator() {
  console.log('🔥 Starting Firestore emulator...');

  // Use npx to run local firebase-tools from devDependencies
  // This ensures we use the version specified in package.json
  emulatorProcess = spawn(
    'npx',
    [
      'firebase',
      'emulators:start',
      '--only=firestore',
      '--project=smart-repo-test',
    ],
    {
      stdio: 'pipe',
      detached: false,
      cwd: __dirname, // Ensure we're in the right directory to find package.json
    }
  );

  // Wait for emulator to be ready
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Firestore emulator failed to start within 30 seconds'));
    }, 30000);

    emulatorProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`Emulator: ${output}`);

      // Look for the ready message
      if (output.includes('All emulators ready')) {
        clearTimeout(timeout);
        console.log('✅ Firestore emulator is ready!');
        resolve();
      }
    });

    emulatorProcess.stderr.on('data', (data) => {
      console.error(`Emulator error: ${data}`);
    });

    emulatorProcess.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    emulatorProcess.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Emulator process exited with code ${code}`));
      }
    });
  });
}

async function stopEmulator() {
  if (emulatorProcess) {
    console.log('🛑 Stopping Firestore emulator...');

    // Try graceful shutdown first
    emulatorProcess.kill('SIGTERM');

    // Wait a bit for graceful shutdown
    await sleep(2000);

    // Force kill if still running
    if (!emulatorProcess.killed) {
      emulatorProcess.kill('SIGKILL');
    }

    emulatorProcess = null;
    console.log('✅ Firestore emulator stopped');
  }
}

// Jest global setup
module.exports = async () => {
  try {
    await startEmulator();
    // Store the cleanup function globally
    global.__EMULATOR_CLEANUP__ = stopEmulator;
  } catch (error) {
    console.error('❌ Failed to start Firestore emulator:', error.message);
    throw error;
  }
};
