/**
 * Single source of truth for the application version.
 *
 * Keep this in sync with `package.json#version`. It is surfaced to agents and
 * operators in several places (MCP `initialize`, the HTTP `/health` probe, HAR
 * `creator`, etc.) so those never drift from the shipped build.
 */
export const APP_VERSION = '1.5.9';
