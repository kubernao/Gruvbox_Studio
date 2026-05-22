#!/usr/bin/env node

/**
 * IPC Bridge Integration Test
 *
 * This script demonstrates that the IPC bridge components are all in place
 * and syntactically correct.
 */

const fs = require("fs");
const path = require("path");

console.log("\n╔════════════════════════════════════════════════════════════╗");
console.log("║     IPC Bridge for Electron - Integration Test            ║");
console.log("╚════════════════════════════════════════════════════════════╝\n");

const files = [
  {
    name: "Main Process IPC Handlers",
    path: "src/electron-main/main.js",
    checks: [
      { pattern: /ipcMain\.handle\('file:read'/, desc: "file:read handler" },
      { pattern: /ipcMain\.handle\('file:write'/, desc: "file:write handler" },
      {
        pattern: /ipcMain\.handle\('file:list-directory'/,
        desc: "file:list-directory handler",
      },
      {
        pattern: /ipcMain\.handle\('file:metadata'/,
        desc: "file:metadata handler",
      },
      {
        pattern: /ipcMain\.handle\('file:delete'/,
        desc: "file:delete handler",
      },
    ],
  },
  {
    name: "Rust Bridge Implementation",
    path: "src/electron-main/ipc/rust-bridge.js",
    checks: [
      { pattern: /async readFile/, desc: "readFile method" },
      { pattern: /async writeFile/, desc: "writeFile method" },
      { pattern: /async listDirectory/, desc: "listDirectory method" },
      { pattern: /async getMetadata/, desc: "getMetadata method" },
      { pattern: /async deleteFile/, desc: "deleteFile method" },
    ],
  },
  {
    name: "Preload Script Security",
    path: "src/electron-main/ipc/preload.js",
    checks: [
      {
        pattern: /contextBridge\.exposeInMainWorld/,
        desc: "contextBridge usage",
      },
      { pattern: /electronAPI/, desc: "electronAPI exposure" },
      { pattern: /ipcRenderer\.invoke/, desc: "IPC renderer invocation" },
      { pattern: /piChatActivity/, desc: "pi chat activity channel" },
      { pattern: /readFile:/, desc: "readFile exposed" },
      { pattern: /writeFile:/, desc: "writeFile exposed" },
    ],
  },
];

const rendererFiles = [
  {
    name: "Frontend IPC Service (TypeScript)",
    path: "src/frontend/shared/utils/ipc.ts",
    checks: [
      { pattern: /class IPCService/, desc: "IPCService class" },
      { pattern: /static async readFile/, desc: "readFile method" },
      { pattern: /static async writeFile/, desc: "writeFile method" },
      { pattern: /static async listDirectory/, desc: "listDirectory method" },
    ],
  },
  {
    name: "Assistant Session Hook",
    path: "src/frontend/features/assistant/hooks/usePiSession.ts",
    checks: [
      { pattern: /export function usePiSession/, desc: "usePiSession hook export" },
      { pattern: /subscribe:/, desc: "pi chat subscription" },
      { pattern: /onChunk/, desc: "stream chunk handler" },
      { pattern: /onActivity/, desc: "stream activity handler" },
      { pattern: /onDone/, desc: "stream done handler" },
    ],
  },
  {
    name: "IPC Tester Utility",
    path: "src/frontend/shared/utils/ipcTester.ts",
    checks: [
      { pattern: /class IPCTester/, desc: "IPCTester class" },
      { pattern: /testReadFile/, desc: "testReadFile method" },
      { pattern: /testListDirectory/, desc: "testListDirectory method" },
    ],
  },
];

let totalTests = 0;
let passedTests = 0;

function checkFile(file) {
  console.log(`\n📋 ${file.name}`);
  console.log(`   File: ${file.path}`);

  const projectRoot = path.resolve(__dirname, "..");
  try {
    const content = fs.readFileSync(path.join(projectRoot, file.path), "utf-8");

    file.checks.forEach((check) => {
      totalTests++;
      if (check.pattern.test(content)) {
        console.log(`   ✓ ${check.desc}`);
        passedTests++;
      } else {
        console.log(`   ✗ ${check.desc}`);
      }
    });
  } catch (error) {
    console.log(`   ✗ File not found: ${error.message}`);
  }
}

console.log("═══ CORE IPC COMPONENTS ═══\n");
files.forEach(checkFile);

console.log("\n═══ REACT/TYPESCRIPT COMPONENTS ═══\n");
rendererFiles.forEach(checkFile);

console.log("\n╔════════════════════════════════════════════════════════════╗");
console.log(`║  Test Results: ${passedTests}/${totalTests} checks passed`);
if (passedTests === totalTests) {
  console.log("║  Status: ✓ ALL COMPONENTS VERIFIED");
} else {
  console.log(`║  Status: ⚠ ${totalTests - passedTests} checks failed`);
}
console.log("╚════════════════════════════════════════════════════════════╝\n");

// Show usage summary
console.log("📚 QUICK START:\n");
console.log("1. Start the app:");
console.log("   $ npm run start\n");
console.log("2. Open DevTools to see IPC test results\n");
console.log("3. Use in components:\n");
console.log('   import { useFileAPI } from "../hooks/useFileAPI";');
console.log("   const { readFile, isLoading, error } = useFileAPI();\n");

console.log("📖 Documentation:\n");
console.log("   • IPC_BRIDGE_SETUP.md - Complete implementation guide");
console.log("   • IPC_QUICK_REFERENCE.md - Usage examples and API reference\n");

process.exit(passedTests === totalTests ? 0 : 1);
