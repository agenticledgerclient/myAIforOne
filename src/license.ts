/**
 * License verification — calls the MyAIforOne licensing server on startup.
 * If no licenseKey is configured, the platform runs unlicensed (no restrictions).
 * If a licenseKey is present, it must be valid and not expired.
 */

import { log } from "./logger.js";

const DEFAULT_LICENSE_URL = "https://ai41license.agenticledger.ai";

export interface LicenseInfo {
  valid: boolean;
  org?: string;
  name?: string;
  features?: Record<string, boolean | number>;
  expiresAt?: string;
  error?: string;
}

let _cachedLicense: LicenseInfo | null = null;

/**
 * Verify the license key against the licensing server.
 * Returns license info if valid, or throws if invalid/expired.
 * If no licenseKey is configured, returns a valid "unlicensed" result (no restrictions).
 */
export async function verifyLicense(licenseKey?: string, licenseUrl?: string): Promise<LicenseInfo> {
  // No license key configured — run unlicensed (no restrictions)
  if (!licenseKey) {
    _cachedLicense = { valid: true };
    return _cachedLicense;
  }

  const baseUrl = (licenseUrl || DEFAULT_LICENSE_URL).replace(/\/$/, "");
  const url = `${baseUrl}/api/license/verify`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseKey }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    const data = await res.json() as LicenseInfo;

    if (!data.valid) {
      _cachedLicense = data;
      return data;
    }

    _cachedLicense = data;
    log.info(`License verified — org: ${data.org}, expires: ${data.expiresAt}`);
    return data;
  } catch (err) {
    // If we can't reach the licensing server, allow startup with a warning
    // (don't brick the user's platform because of a network issue)
    log.warn(`License server unreachable (${err}). Starting in grace mode.`);
    _cachedLicense = { valid: true, error: "License server unreachable — running in grace mode" };
    return _cachedLicense;
  }
}

/**
 * Get the cached license info (call verifyLicense first).
 */
export function getLicense(): LicenseInfo | null {
  return _cachedLicense;
}

/**
 * Check if a specific feature is enabled in the current license.
 * Returns true if: no license configured, or feature is enabled, or feature not in license.
 * Returns false only if the license explicitly disables the feature.
 */
export function isFeatureEnabled(feature: string): boolean {
  if (!_cachedLicense || !_cachedLicense.features) return true; // no license = no restrictions
  const val = _cachedLicense.features[feature];
  if (val === undefined) return true; // feature not in license = no restriction
  return !!val;
}

/**
 * Get a numeric limit from the license (e.g., maxAgents).
 * Returns Infinity if no license or limit not set.
 */
export function getFeatureLimit(feature: string): number {
  if (!_cachedLicense || !_cachedLicense.features) return Infinity;
  const val = _cachedLicense.features[feature];
  if (typeof val === "number") return val;
  return Infinity;
}

/**
 * Check if the platform is licensed to execute agents.
 * Returns null if OK, or an error message if blocked.
 *
 * Rules:
 * - No licenseKey configured → allowed (unlicensed mode, no restrictions)
 * - Valid licenseKey → allowed
 * - Invalid/expired licenseKey → blocked
 */
export function checkLicenseForExecution(): string | null {
  if (!_cachedLicense) return null; // verifyLicense hasn't been called yet — allow
  if (_cachedLicense.valid) return null; // valid or unlicensed — allow
  return `License invalid: ${_cachedLicense.error || "expired or revoked"}. Enter a valid license key in Admin → Settings and restart.`;
}

/**
 * Re-verify the license (called when the key is updated via Admin UI).
 */
export async function reverifyLicense(licenseKey?: string, licenseUrl?: string): Promise<LicenseInfo> {
  return verifyLicense(licenseKey, licenseUrl);
}
