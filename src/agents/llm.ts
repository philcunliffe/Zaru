/**
 * LLM Provider Abstraction Layer
 *
 * Provides a unified interface for LLM providers, starting with OpenAI.
 * Architecture supports adding more providers (Anthropic, etc.) in the future.
 */

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";

// Available model identifiers
export type ModelId =
  | "gpt-5.2"
  | "gpt-5-mini"
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-4-turbo"
  | "gpt-3.5-turbo";

// Provider configuration
export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
}

// Permission type for model selection
export type PermissionType = "READ" | "WRITE" | "READ_WRITE";

// Model configuration for different use cases
export interface ModelConfig {
  // Primary model for complex reasoning tasks (orchestration, planning)
  primary: ModelId;
  // Fast model for simpler tasks (sub-agents, quick responses)
  fast: ModelId;
  // Model for each permission type (optional override)
  permissions?: {
    READ?: ModelId;
    WRITE?: ModelId;
    READ_WRITE?: ModelId;
  };
}

// Default model configuration
const DEFAULT_MODEL_CONFIG: ModelConfig = {
  primary: "gpt-5.2",
  fast: "gpt-5-mini",
  permissions: {
    READ: "gpt-5-mini",
    WRITE: "gpt-5-mini",
    READ_WRITE: "gpt-5.2", // READ_WRITE agents use primary model like orchestrator
  },
};

/**
 * LLM Provider Manager
 *
 * Manages LLM provider instances and model selection.
 * Currently supports OpenAI, extensible for other providers.
 */
export class LLMProvider {
  private openai: ReturnType<typeof createOpenAI>;
  private config: ModelConfig;

  constructor(providerConfig?: ProviderConfig, modelConfig?: ModelConfig) {
    this.openai = createOpenAI({
      apiKey: providerConfig?.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: providerConfig?.baseURL,
    });

    this.config = modelConfig ?? DEFAULT_MODEL_CONFIG;
  }

  /**
   * Get the primary model for complex reasoning tasks
   */
  getPrimaryModel(): LanguageModelV1 {
    return this.openai(this.config.primary);
  }

  /**
   * Get the fast model for simpler tasks
   */
  getFastModel(): LanguageModelV1 {
    return this.openai(this.config.fast);
  }

  /**
   * Get a specific model by ID
   */
  getModel(modelId: ModelId): LanguageModelV1 {
    return this.openai(modelId);
  }

  /**
   * Get the model for a specific permission type
   * Falls back to fast model if no specific model is configured
   */
  getModelForPermission(permission: PermissionType): LanguageModelV1 {
    const modelId = this.config.permissions?.[permission] ?? this.config.fast;
    return this.openai(modelId);
  }

  /**
   * Get the model ID for a specific permission type
   * Falls back to fast model if no specific model is configured
   */
  getModelIdForPermission(permission: PermissionType): ModelId {
    return this.config.permissions?.[permission] ?? this.config.fast;
  }

  /**
   * Get current model configuration
   */
  getModelConfig(): ModelConfig {
    return { ...this.config };
  }
}

// Singleton instance for the application
let _defaultProvider: LLMProvider | null = null;

/**
 * Get the default LLM provider instance
 */
export function getDefaultProvider(): LLMProvider {
  if (!_defaultProvider) {
    _defaultProvider = new LLMProvider();
  }
  return _defaultProvider;
}

/**
 * Initialize the default LLM provider with custom configuration
 */
export function initProvider(
  providerConfig?: ProviderConfig,
  modelConfig?: ModelConfig
): LLMProvider {
  _defaultProvider = new LLMProvider(providerConfig, modelConfig);
  return _defaultProvider;
}
