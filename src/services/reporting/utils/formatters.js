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
 * Format a date to a readable string
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date
 */
function formatDate(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a date and time to a readable string
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date and time
 */
function formatDateTime(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format duration in milliseconds to human-readable string
 * @param {Date|string} startDate - Start date
 * @param {Date|string} endDate - End date
 * @returns {string} Formatted duration
 */
function formatDuration(startDate, endDate) {
  if (!startDate || !endDate) return 'N/A';

  const start = new Date(startDate);
  const end = new Date(endDate);
  const durationMs = end - start;

  if (durationMs < 0) return 'N/A';

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Format a percentage
 * @param {number} value - Value to format
 * @param {number} total - Total value
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted percentage
 */
function formatPercentage(value, total, decimals = 1) {
  if (!total || total === 0) return '0%';
  const percentage = (value / total) * 100;
  return `${percentage.toFixed(decimals)}%`;
}

/**
 * Format a confidence score
 * @param {number} confidence - Confidence value (0-1)
 * @returns {string} Formatted confidence
 */
function formatConfidence(confidence) {
  if (confidence == null) return 'N/A';
  return `${(confidence * 100).toFixed(0)}%`;
}

/**
 * Get status emoji and text
 * @param {string} conclusion - Job/run conclusion
 * @returns {Object} Status info with emoji and class
 */
function getStatusInfo(conclusion) {
  const statusMap = {
    success: { emoji: '✅', text: 'Success', class: 'status-success' },
    failure: { emoji: '❌', text: 'Failed', class: 'status-failure' },
    cancelled: { emoji: '🚫', text: 'Cancelled', class: 'status-cancelled' },
    skipped: { emoji: '⏭️', text: 'Skipped', class: 'status-skipped' },
    neutral: { emoji: '⚪', text: 'Neutral', class: 'status-neutral' },
  };

  return statusMap[conclusion?.toLowerCase()] || {
    emoji: '❓',
    text: conclusion || 'Unknown',
    class: 'status-unknown'
  };
}

/**
 * Truncate text to a maximum length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
function truncate(text, maxLength = 100) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

module.exports = {
  formatDate,
  formatDateTime,
  formatDuration,
  formatPercentage,
  formatConfidence,
  getStatusInfo,
  truncate,
  escapeHtml,
};
