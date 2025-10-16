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

/**
 * Pattern-based root cause detection (Level 1)
 * Fast, free, and handles common failure patterns
 */

const PATTERNS = [
  {
    id: 1,
    category: 'rate_limit',
    title: 'GitHub API Rate Limit Exceeded',
    pattern: /API rate limit exceeded/i,
    confidence: 1.0,
    description: 'The GitHub Actions workflow hit API rate limits.',
    suggestedFix: 'Wait for the rate limit to reset (usually 1 hour) or use a different GitHub token with higher limits.'
  },
  {
    id: 2,
    category: 'dependency_missing',
    title: 'Docker Image Not Found',
    pattern: /(artifact.*not found|Error.*unknown.*artifact|image.*not found)/i,
    confidence: 0.95,
    description: 'A required Docker image or artifact could not be found in the registry.',
    suggestedFix: 'Verify the Docker image name and tag. Check repository access permissions and ensure the image was published successfully.'
  },
  {
    id: 3,
    category: 'network_timeout',
    title: 'Network Timeout or Connection Refused',
    pattern: /(timeout|timed out|connection.*refused|ETIMEDOUT|ECONNREFUSED)/i,
    confidence: 0.9,
    description: 'Network operation timed out or connection was refused.',
    suggestedFix: 'Retry the job. If persistent, check network connectivity and service availability.'
  },
  {
    id: 4,
    category: 'dependency_missing',
    title: 'NPM Install Failed',
    pattern: /(npm ERR!|Failed to install dependencies|npm.*ERESOLVE)/i,
    confidence: 0.9,
    description: 'NPM package installation failed.',
    suggestedFix: 'Check package.json for errors, verify npm registry availability, and ensure compatible package versions.'
  },
  {
    id: 5,
    category: 'resource_limit',
    title: 'Out of Memory',
    pattern: /(OOM|out of memory|heap.*out of memory|JavaScript heap out of memory)/i,
    confidence: 0.95,
    description: 'The process ran out of available memory.',
    suggestedFix: 'Increase memory allocation for the job or optimize memory usage in the application.'
  },
  {
    id: 6,
    category: 'test_failure',
    title: 'Test Failure',
    pattern: /(tests? failed|assertion.*failed|expected.*but (got|was|received))/i,
    confidence: 0.85,
    description: 'One or more tests failed.',
    suggestedFix: 'Review the test output to identify which tests failed and why. Check for code changes that might have broken the tests.'
  },
  {
    id: 7,
    category: 'authentication_error',
    title: 'Authentication Failed',
    pattern: /(authentication.*failed|unauthorized|401|403|permission denied|access denied)/i,
    confidence: 0.9,
    description: 'Authentication or authorization failed.',
    suggestedFix: 'Verify credentials, tokens, or API keys. Check permissions for the resource being accessed.'
  },
  {
    id: 8,
    category: 'build_error',
    title: 'Compilation or Build Error',
    pattern: /(compilation failed|build failed|syntax error|cannot find module)/i,
    confidence: 0.85,
    description: 'Code compilation or build process failed.',
    suggestedFix: 'Check the error details for syntax errors, missing dependencies, or configuration issues.'
  },
  {
    id: 9,
    category: 'deployment_error',
    title: 'Deployment Failed',
    pattern: /(deployment failed|deploy.*error|rollback|failed to publish)/i,
    confidence: 0.85,
    description: 'Deployment process failed.',
    suggestedFix: 'Check deployment logs for specific errors. Verify target environment is accessible and healthy.'
  },
  {
    id: 10,
    category: 'generic_failure',
    title: 'Process Exited with Error Code',
    pattern: /Process completed with exit code [1-9]/i,
    confidence: 0.5,
    description: 'Process terminated with a non-zero exit code.',
    suggestedFix: 'Review the full logs to determine the specific cause of failure.'
  }
];

/**
 * Attempts to match error messages against known patterns
 * @param {Array<Object>} errorAnnotations - Array of error annotation objects
 * @param {Array<Object>} failedSteps - Array of failed step objects
 * @returns {Object|null} Matched pattern or null
 */
function matchPattern(errorAnnotations, failedSteps) {
  // Combine all error messages
  const messages = [];

  errorAnnotations.forEach(annotation => {
    if (annotation.message) messages.push(annotation.message);
    if (annotation.title) messages.push(annotation.title);
  });

  failedSteps.forEach(step => {
    if (step.name) messages.push(step.name);
  });

  const combinedText = messages.join('\n');

  // Try to match against patterns (order matters - more specific first)
  for (const pattern of PATTERNS) {
    if (pattern.pattern.test(combinedText)) {
      return {
        patternId: pattern.id,
        category: pattern.category,
        title: pattern.title,
        description: pattern.description,
        suggestedFix: pattern.suggestedFix,
        confidence: pattern.confidence,
        matchedText: extractMatch(combinedText, pattern.pattern)
      };
    }
  }

  return null;
}

/**
 * Extracts the matched text for debugging
 */
function extractMatch(text, pattern) {
  const match = text.match(pattern);
  if (match) {
    const start = Math.max(0, match.index - 50);
    const end = Math.min(text.length, match.index + match[0].length + 50);
    return '...' + text.substring(start, end) + '...';
  }
  return null;
}

/**
 * Get all available patterns
 */
function getPatterns() {
  return PATTERNS;
}

/**
 * Get pattern by ID
 */
function getPatternById(id) {
  return PATTERNS.find(p => p.id === id);
}

module.exports = {
  matchPattern,
  getPatterns,
  getPatternById,
  PATTERNS
};

