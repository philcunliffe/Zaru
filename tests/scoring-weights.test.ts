/**
 * Scoring Weights Tests
 *
 * Tests for weight constants, tier classification, and configurable thresholds.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  STEP_TYPE_SCORES,
  PERMISSION_SCORES,
  AGENT_PERMISSION_SCORES,
  INTENT_CONFIDENCE_PENALTIES,
  ORCHESTRATOR_DECRYPTION_PENALTY,
  DEFAULT_TIER_THRESHOLDS,
  getTierThresholds,
  classifyTier,
  tierRequiresConfirmation,
} from "../src/scoring";

// ============================================================================
// Weight Constants
// ============================================================================

describe("Step Type Base Scores", () => {
  test("respond has zero risk", () => {
    expect(STEP_TYPE_SCORES.respond).toBe(0);
  });

  test("approve has zero risk (user checkpoint)", () => {
    expect(STEP_TYPE_SCORES.approve).toBe(0);
  });

  test("gather has minimal risk", () => {
    expect(STEP_TYPE_SCORES.gather).toBe(1);
  });

  test("delegate scores higher than gather", () => {
    expect(STEP_TYPE_SCORES.delegate).toBeGreaterThan(STEP_TYPE_SCORES.gather);
  });

  test("route scores higher than delegate", () => {
    expect(STEP_TYPE_SCORES.route).toBeGreaterThan(STEP_TYPE_SCORES.delegate);
  });

  test("unknown has highest base score", () => {
    expect(STEP_TYPE_SCORES.unknown).toBe(4);
    for (const [type, score] of Object.entries(STEP_TYPE_SCORES)) {
      if (type !== "unknown") {
        expect(STEP_TYPE_SCORES.unknown).toBeGreaterThanOrEqual(score);
      }
    }
  });

  test("covers all PlanStepType values", () => {
    const expectedTypes = ["respond", "approve", "gather", "delegate", "route", "unknown"];
    expect(Object.keys(STEP_TYPE_SCORES).sort()).toEqual(expectedTypes.sort());
  });
});

describe("Permission Scores", () => {
  test("makePayment is the highest risk permission", () => {
    for (const [perm, score] of Object.entries(PERMISSION_SCORES)) {
      if (perm !== "makePayment") {
        expect(PERMISSION_SCORES.makePayment).toBeGreaterThanOrEqual(score);
      }
    }
  });

  test("deleteContent is higher risk than sendEmail", () => {
    expect(PERMISSION_SCORES.deleteContent).toBeGreaterThan(PERMISSION_SCORES.sendEmail);
  });

  test("createDocument and modifyCalendar are low risk", () => {
    expect(PERMISSION_SCORES.createDocument).toBeLessThanOrEqual(2);
    expect(PERMISSION_SCORES.modifyCalendar).toBeLessThanOrEqual(2);
  });

  test("covers all ExplicitPermissions fields", () => {
    const expectedPerms = [
      "sendEmail",
      "makePayment",
      "deleteContent",
      "submitForm",
      "shareContent",
      "createDocument",
      "modifyCalendar",
    ];
    expect(Object.keys(PERMISSION_SCORES).sort()).toEqual(expectedPerms.sort());
  });
});

describe("Agent Permission Scores", () => {
  test("READ agents have zero additional risk", () => {
    expect(AGENT_PERMISSION_SCORES.READ).toBe(0);
  });

  test("WRITE agents add moderate risk", () => {
    expect(AGENT_PERMISSION_SCORES.WRITE).toBe(2);
  });

  test("READ_WRITE agents have highest risk", () => {
    expect(AGENT_PERMISSION_SCORES.READ_WRITE).toBeGreaterThan(AGENT_PERMISSION_SCORES.WRITE);
  });

  test("covers all AgentPermission values", () => {
    expect(Object.keys(AGENT_PERMISSION_SCORES).sort()).toEqual(
      ["READ", "READ_WRITE", "WRITE"].sort()
    );
  });
});

describe("Intent Confidence Penalties", () => {
  test("high confidence has no penalty", () => {
    expect(INTENT_CONFIDENCE_PENALTIES.high).toBe(0);
  });

  test("low confidence has the highest penalty", () => {
    expect(INTENT_CONFIDENCE_PENALTIES.low).toBeGreaterThan(
      INTENT_CONFIDENCE_PENALTIES.medium
    );
  });

  test("medium confidence penalty is between high and low", () => {
    expect(INTENT_CONFIDENCE_PENALTIES.medium).toBeGreaterThan(
      INTENT_CONFIDENCE_PENALTIES.high
    );
    expect(INTENT_CONFIDENCE_PENALTIES.medium).toBeLessThan(
      INTENT_CONFIDENCE_PENALTIES.low
    );
  });
});

describe("Orchestrator Decryption Penalty", () => {
  test("is a positive value", () => {
    expect(ORCHESTRATOR_DECRYPTION_PENALTY).toBeGreaterThan(0);
  });

  test("is 2 per occurrence", () => {
    expect(ORCHESTRATOR_DECRYPTION_PENALTY).toBe(2);
  });
});

// ============================================================================
// Tier Classification
// ============================================================================

describe("Tier Thresholds", () => {
  test("LOW starts at 0", () => {
    expect(DEFAULT_TIER_THRESHOLDS.LOW).toBe(0);
  });

  test("thresholds increase monotonically", () => {
    expect(DEFAULT_TIER_THRESHOLDS.MODERATE).toBeGreaterThan(DEFAULT_TIER_THRESHOLDS.LOW);
    expect(DEFAULT_TIER_THRESHOLDS.HIGH).toBeGreaterThan(DEFAULT_TIER_THRESHOLDS.MODERATE);
    expect(DEFAULT_TIER_THRESHOLDS.CRITICAL).toBeGreaterThan(DEFAULT_TIER_THRESHOLDS.HIGH);
  });

  test("match design spec values", () => {
    expect(DEFAULT_TIER_THRESHOLDS.LOW).toBe(0);
    expect(DEFAULT_TIER_THRESHOLDS.MODERATE).toBe(8);
    expect(DEFAULT_TIER_THRESHOLDS.HIGH).toBe(16);
    expect(DEFAULT_TIER_THRESHOLDS.CRITICAL).toBe(30);
  });
});

describe("classifyTier", () => {
  test("score 0 is LOW", () => {
    expect(classifyTier(0)).toBe("LOW");
  });

  test("score 7 is LOW (upper boundary)", () => {
    expect(classifyTier(7)).toBe("LOW");
  });

  test("score 8 is MODERATE (exact boundary)", () => {
    expect(classifyTier(8)).toBe("MODERATE");
  });

  test("score 15 is MODERATE (upper boundary)", () => {
    expect(classifyTier(15)).toBe("MODERATE");
  });

  test("score 16 is HIGH (exact boundary)", () => {
    expect(classifyTier(16)).toBe("HIGH");
  });

  test("score 29 is HIGH (upper boundary)", () => {
    expect(classifyTier(29)).toBe("HIGH");
  });

  test("score 30 is CRITICAL (exact boundary)", () => {
    expect(classifyTier(30)).toBe("CRITICAL");
  });

  test("score 100 is CRITICAL", () => {
    expect(classifyTier(100)).toBe("CRITICAL");
  });

  test("negative score is LOW", () => {
    expect(classifyTier(-1)).toBe("LOW");
  });
});

describe("tierRequiresConfirmation", () => {
  test("LOW does not require confirmation", () => {
    expect(tierRequiresConfirmation("LOW")).toBe(false);
  });

  test("MODERATE does not require confirmation", () => {
    expect(tierRequiresConfirmation("MODERATE")).toBe(false);
  });

  test("HIGH requires confirmation", () => {
    expect(tierRequiresConfirmation("HIGH")).toBe(true);
  });

  test("CRITICAL requires confirmation", () => {
    expect(tierRequiresConfirmation("CRITICAL")).toBe(true);
  });
});

// ============================================================================
// Configurable Thresholds
// ============================================================================

describe("getTierThresholds", () => {
  const configDir = join(homedir(), ".zaru");
  const configFile = join(configDir, "config.json");
  let originalContent: string | null = null;

  beforeEach(() => {
    if (existsSync(configFile)) {
      originalContent = readFileSync(configFile, "utf-8");
    } else {
      originalContent = null;
    }
  });

  afterEach(() => {
    if (originalContent !== null) {
      writeFileSync(configFile, originalContent);
    } else if (existsSync(configFile)) {
      // Config didn't exist before — restore by removing only if we created it
      // Don't delete in case other tests depend on it; just restore
      unlinkSync(configFile);
    }
  });

  test("returns defaults when no config file exists", () => {
    // This test relies on defaults when scoring key is absent
    const thresholds = getTierThresholds();
    expect(thresholds.LOW).toBe(DEFAULT_TIER_THRESHOLDS.LOW);
    expect(thresholds.MODERATE).toBe(DEFAULT_TIER_THRESHOLDS.MODERATE);
    expect(thresholds.HIGH).toBe(DEFAULT_TIER_THRESHOLDS.HIGH);
    expect(thresholds.CRITICAL).toBe(DEFAULT_TIER_THRESHOLDS.CRITICAL);
  });

  test("merges partial user overrides with defaults", () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      configFile,
      JSON.stringify({
        scoring: {
          thresholds: { HIGH: 20, CRITICAL: 40 },
        },
      })
    );

    const thresholds = getTierThresholds();
    expect(thresholds.LOW).toBe(0);       // default
    expect(thresholds.MODERATE).toBe(8);  // default
    expect(thresholds.HIGH).toBe(20);     // overridden
    expect(thresholds.CRITICAL).toBe(40); // overridden
  });

  test("handles config with no scoring key gracefully", () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configFile, JSON.stringify({ google: { account: "test" } }));

    const thresholds = getTierThresholds();
    expect(thresholds).toEqual(DEFAULT_TIER_THRESHOLDS);
  });

  test("handles malformed config gracefully", () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configFile, "not valid json {{{");

    const thresholds = getTierThresholds();
    expect(thresholds).toEqual(DEFAULT_TIER_THRESHOLDS);
  });
});
