/*
 * Prompt Builder - Loads and builds prompts from templates
 *
 * Responsibilities:
 * - Load prompt templates from prompts.json
 * - Perform variable substitution with {{variable}} syntax
 * - Validate prompt structure
 *
 * Does NOT know about: LLM providers, API calls, business logic
 */

const fs = require('fs');
const path = require('path');

class PromptBuilder {
  constructor(promptsPath = null) {
    this.promptsPath = promptsPath || path.join(__dirname, 'prompts.json');
    this.templates = null;
  }

  /**
   * Load prompt templates from JSON file
   */
  loadTemplates() {
    if (this.templates) {
      return this.templates;
    }

    try {
      const fileContent = fs.readFileSync(this.promptsPath, 'utf8');
      this.templates = JSON.parse(fileContent);
      return this.templates;
    } catch (error) {
      throw new Error(`Failed to load prompts from ${this.promptsPath}: ${error.message}`);
    }
  }

  /**
   * Build prompt messages from template with variable substitution
   *
   * @param {string} templateName - Name of the template (e.g., 'rootCauseAnalysis')
   * @param {Object} variables - Variables to substitute in template
   * @returns {Array} Array of message objects [{ role: 'system', content: '...' }, ...]
   */
  build(templateName, variables = {}) {
    const templates = this.loadTemplates();

    if (!templates[templateName]) {
      throw new Error(`Template '${templateName}' not found`);
    }

    const template = templates[templateName];

    // Build system message
    const systemMessage = {
      role: 'system',
      content: this._substitute(template.system, variables)
    };

    if (template.examples) {
      systemMessage.content += `\n\nHere are some examples:\n${template.examples.join('\n\n')}`;
    }

    if (template.outputFormat) {
      systemMessage.content += `\n\nPlease respond in the following format:${JSON.stringify(template.outputFormat)}`;
    }



    // Build user message from template
    const userMessage = {
      role: 'user',
      content: this._substitute(template.userTemplate, variables)
    };

    return [systemMessage, userMessage];
  }

  /**
   * Get template metadata (output format, examples, etc.)
   */
  getTemplateMetadata(templateName) {
    const templates = this.loadTemplates();

    if (!templates[templateName]) {
      throw new Error(`Template '${templateName}' not found`);
    }

    return {
      outputFormat: templates[templateName].outputFormat,
      examples: templates[templateName].examples || []
    };
  }

  /**
   * Perform simple string substitution with {{variable}} syntax
   *
   * @private
   */
  _substitute(template, variables) {
    if (!template) {
      return '';
    }

    let result = template;

    // Replace all {{variable}} placeholders
    const placeholderRegex = /\{\{(\w+)\}\}/g;

    result = result.replace(placeholderRegex, (match, varName) => {
      if (varName in variables) {
        const value = variables[varName];

        // Handle arrays - join with newlines
        if (Array.isArray(value)) {
          return value.map(item => {
            if (typeof item === 'object') {
              return JSON.stringify(item, null, 2);
            }
            return String(item);
          }).join('\n');
        }

        // Handle objects - stringify
        if (typeof value === 'object' && value !== null) {
          return JSON.stringify(value, null, 2);
        }

        return String(value);
      }

      // Leave placeholder as-is if variable not provided
      return match;
    });

    return result;
  }

  /**
   * Validate that all required variables are provided
   *
   * @param {string} template - Template string
   * @param {Object} variables - Provided variables
   * @returns {Array} Array of missing variable names
   */
  getMissingVariables(template, variables) {
    const placeholderRegex = /\{\{(\w+)\}\}/g;
    const matches = template.matchAll(placeholderRegex);
    const missing = [];

    for (const match of matches) {
      const varName = match[1];
      if (!(varName in variables)) {
        missing.push(varName);
      }
    }

    return missing;
  }
}

module.exports = { PromptBuilder };

