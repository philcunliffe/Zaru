/**
 * Gmail Service - Backward Compatibility Module
 *
 * This module re-exports from the new google/ directory location.
 * Existing code importing from this path will continue to work.
 */

// Re-export everything from the new location
export {
  GmailService,
  getGmailService,
  isGmailConfigured,
  resetGmailService,
  type GmailMessage,
  type GmailThread,
  type GmailLabel,
  type SendEmailOptions,
  type SendEmailResult,
} from "./google/gmail";

// Re-export config functions for backward compatibility
export {
  loadConfig,
  saveConfig,
  getGoogleAccount as getGmailAccount,
  type ZaruConfig,
} from "./google/base";
