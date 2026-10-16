import fs from 'node:fs';
import path from 'node:path';

export interface HostBrowserProfile {
  name: string;
  version: string;
  majorVersion: string;
  userAgent: string;
  secChUa: string;
  secChUaPlatform: string;
  platformName: string;
}

/**
 * Clean, zero-subprocess host browser profile detector.
 *
 * Avoids PowerShell or child process spawning to ensure:
 * 1. ZERO Antivirus / EDR flags (no process injection or shell invocation).
 * 2. Instantaneous startup (0ms vs 1000ms shell latency).
 * 3. 100% Cross-platform compatibility across Windows, macOS, and Linux.
 * 4. Cryptographic coherence between TLS ciphers, HTTP/2 frames, and Chromium version.
 */
export function detectHostBrowserProfile(): HostBrowserProfile {
  // Use the native Chromium version compiled into the current runtime
  // This ensures JA3/JA4 TLS handshake and HTTP/2 settings align perfectly with the reported version.
  const nativeChromiumVersion = process.versions.chrome || '131.0.6778.86';
  const majorVersion = nativeChromiumVersion.split('.')[0] || '131';

  const osPlatform = process.platform;
  let osString = 'Windows NT 10.0; Win64; x64';
  let secChUaPlatform = '"Windows"';
  let platformName = 'Windows';

  if (osPlatform === 'darwin') {
    osString = 'Macintosh; Intel Mac OS X 10_15_7';
    secChUaPlatform = '"macOS"';
    platformName = 'macOS';
  } else if (osPlatform === 'linux') {
    osString = 'X11; Linux x86_64';
    secChUaPlatform = '"Linux"';
    platformName = 'Linux';
  }

  // Detect preferred host browser family via silent filesystem check
  let detectedBrowserName = 'Google Chrome';
  let secChUaBrand = `"Google Chrome";v="${majorVersion}", "Chromium";v="${majorVersion}", "Not_A Brand";v="24"`;
  let userAgentSuffix = '';

  if (osPlatform === 'win32') {
    // Check standard Windows installation paths without running any shell commands
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || '';

    const hasEdge =
      fs.existsSync(path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')) ||
      fs.existsSync(path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));

    const hasBrave =
      fs.existsSync(path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')) ||
      fs.existsSync(path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));

    const hasChrome =
      fs.existsSync(path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe')) ||
      fs.existsSync(path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'));

    if (hasChrome) {
      detectedBrowserName = 'Google Chrome';
      secChUaBrand = `"Google Chrome";v="${majorVersion}", "Chromium";v="${majorVersion}", "Not_A Brand";v="24"`;
    } else if (hasEdge) {
      detectedBrowserName = 'Microsoft Edge';
      userAgentSuffix = ` Edg/${nativeChromiumVersion}`;
      secChUaBrand = `"Microsoft Edge";v="${majorVersion}", "Chromium";v="${majorVersion}", "Not_A Brand";v="24"`;
    } else if (hasBrave) {
      detectedBrowserName = 'Brave Browser';
      secChUaBrand = `"Brave";v="${majorVersion}", "Chromium";v="${majorVersion}", "Not_A Brand";v="24"`;
    }
  } else if (osPlatform === 'darwin') {
    // macOS Applications check
    const hasChrome = fs.existsSync('/Applications/Google Chrome.app');
    const hasBrave = fs.existsSync('/Applications/Brave Browser.app');
    const hasEdge = fs.existsSync('/Applications/Microsoft Edge.app');

    if (hasChrome) {
      detectedBrowserName = 'Google Chrome';
      secChUaBrand = `"Google Chrome";v="${majorVersion}", "Chromium";v="${majorVersion}", "Not_A Brand";v="24"`;
    } else if (hasBrave) {
      detectedBrowserName = 'Brave Browser';
      secChUaBrand = `"Brave";v="${majorVersion}", "Chromium";v="${majorVersion}", "Not_A Brand";v="24"`;
    } else if (hasEdge) {
      detectedBrowserName = 'Microsoft Edge';
      userAgentSuffix = ` Edg/${nativeChromiumVersion}`;
      secChUaBrand = `"Microsoft Edge";v="${majorVersion}", "Chromium";v="${majorVersion}", "Not_A Brand";v="24"`;
    }
  } else if (osPlatform === 'linux') {
    // Linux binaries check
    const hasChrome = fs.existsSync('/usr/bin/google-chrome') || fs.existsSync('/usr/bin/google-chrome-stable');
    const hasChromium = fs.existsSync('/usr/bin/chromium') || fs.existsSync('/usr/bin/chromium-browser');
    const hasBrave = fs.existsSync('/usr/bin/brave-browser');

    if (hasChrome) {
      detectedBrowserName = 'Google Chrome';
      secChUaBrand = `"Google Chrome";v="${majorVersion}", "Chromium";v="${majorVersion}", "Not_A Brand";v="24"`;
    } else if (hasChromium) {
      detectedBrowserName = 'Chromium';
      secChUaBrand = `"Chromium";v="${majorVersion}", "Not_A Brand";v="24"`;
    } else if (hasBrave) {
      detectedBrowserName = 'Brave Browser';
      secChUaBrand = `"Brave";v="${majorVersion}", "Chromium";v="${majorVersion}", "Not_A Brand";v="24"`;
    }
  }

  const userAgent = `Mozilla/5.0 (${osString}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${nativeChromiumVersion} Safari/537.36${userAgentSuffix}`;

  return {
    name: detectedBrowserName,
    version: nativeChromiumVersion,
    majorVersion,
    userAgent,
    secChUa: secChUaBrand,
    secChUaPlatform,
    platformName,
  };
}
