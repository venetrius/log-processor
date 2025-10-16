/*
 * Copyright Camunda Services GmbH and/or licensed to Camunda Services GmbH
 * under one or more contributor license agreements. See the NOTICE file
 * distributed with this work for additional information regarding copyright
 * ownership. Camunda licenses this file to you under the Apache License,
 * Version 2.0; you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*
 * LLM Module Constants
 *
 * Centralized constants for template names, response types, categories, etc.
 * Used across the LLM integration to avoid hardcoding strings
 */

// Template Names
const TEMPLATES = {
  ROOT_CAUSE_ANALYSIS: 'rootCauseAnalysis',
};

// Response Types (discriminator values)
const RESPONSE_TYPES = {
  ROOT_CAUSE: 'root_cause',
  NEED_MORE_INFO: 'need_more_info',
};

// Root Cause Categories
const CATEGORIES = {
  BUILD: 'build',
  TEST: 'test',
  DEPLOYMENT: 'deployment',
  DEPENDENCY: 'dependency',
  INFRASTRUCTURE: 'infrastructure',
  AUTHENTICATION: 'authentication',
  TIMEOUT: 'timeout',
  RESOURCE: 'resource',
  UNKNOWN: 'unknown',
};

// LLM Provider Names
const PROVIDERS = {
  MOCK: 'mock',
  TEST: 'test',
  GITHUB_COPILOT: 'github-copilot',
  COPILOT: 'copilot',
  OPENAI: 'openai',
};

// Message Roles
const MESSAGE_ROLES = {
  SYSTEM: 'system',
  USER: 'user',
  ASSISTANT: 'assistant',
};

// Log Request Directions (for need_more_info)
const LOG_DIRECTIONS = {
  BEFORE: 'before',
  AFTER: 'after',
  BOTH: 'both',
};

// Default Configuration Values
const DEFAULTS = {
  TIMEOUT: 60000, // 60 seconds
  MAX_TOKENS: 1000,
  TEMPERATURE: 0.1,
  CONFIDENCE_THRESHOLD: 0.8,
  INITIAL_LOG_LINES: 50,
  MAX_FOLLOW_UP_ATTEMPTS: 2,
};

module.exports = {
  TEMPLATES,
  RESPONSE_TYPES,
  CATEGORIES,
  PROVIDERS,
  MESSAGE_ROLES,
  LOG_DIRECTIONS,
  DEFAULTS,
};

