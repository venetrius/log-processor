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

const {
  formatDateTime,
  formatDuration,
  formatPercentage,
  formatConfidence,
  getStatusInfo,
  truncate,
  escapeHtml
} = require('./utils/formatters');

/**
 * HTML builder for generating report HTML
 */

/**
 * Generate complete HTML report
 * @param {Object} data - Report data
 * @param {Object} options - Report options
 * @returns {string} HTML content
 */
function generateHTML(data, options = {}) {
  const { summary, topRootCauses, workflowData, stepFailures } = data;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workflow Analysis Report - ${formatDateTime(new Date())}</title>
  ${getStyles()}
</head>
<body>
  <div class="container">
    ${buildHeader(options)}
    ${buildExecutiveSummary(summary)}
    ${buildTopRootCauses(topRootCauses)}
    ${buildWorkflowBreakdown(workflowData, stepFailures, options)}
    ${buildFooter()}
  </div>
  ${getScripts()}
</body>
</html>`;
}

/**
 * Get embedded CSS styles
 * @returns {string} Style tag with CSS
 */
function getStyles() {
  return `<style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
      padding: 20px;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    
    h1 {
      color: #2c3e50;
      margin-bottom: 10px;
      font-size: 2.5em;
      border-bottom: 3px solid #3498db;
      padding-bottom: 10px;
    }
    
    h2 {
      color: #34495e;
      margin-top: 40px;
      margin-bottom: 20px;
      font-size: 1.8em;
      border-left: 4px solid #3498db;
      padding-left: 15px;
    }
    
    h3 {
      color: #5a6c7d;
      margin-top: 30px;
      margin-bottom: 15px;
      font-size: 1.4em;
    }
    
    .header-info {
      color: #7f8c8d;
      margin-bottom: 30px;
      font-size: 0.95em;
    }
    
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin: 30px 0;
    }
    
    .card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 25px;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    
    .card.success {
      background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
    }
    
    .card.failure {
      background: linear-gradient(135deg, #ee0979 0%, #ff6a00 100%);
    }
    
    .card.neutral {
      background: linear-gradient(135deg, #4b6cb7 0%, #182848 100%);
    }
    
    .card-title {
      font-size: 0.9em;
      opacity: 0.9;
      margin-bottom: 10px;
    }
    
    .card-value {
      font-size: 2.5em;
      font-weight: bold;
      margin-bottom: 5px;
    }
    
    .card-subtitle {
      font-size: 0.85em;
      opacity: 0.8;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      background: white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    
    th {
      background-color: #3498db;
      color: white;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
    }
    
    th:hover {
      background-color: #2980b9;
    }
    
    td {
      padding: 12px;
      border-bottom: 1px solid #ecf0f1;
    }
    
    tr:hover {
      background-color: #f8f9fa;
    }
    
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: 600;
    }
    
    .status-success {
      background-color: #d4edda;
      color: #155724;
    }
    
    .status-failure {
      background-color: #f8d7da;
      color: #721c24;
    }
    
    .status-cancelled {
      background-color: #fff3cd;
      color: #856404;
    }
    
    .status-skipped {
      background-color: #e2e3e5;
      color: #383d41;
    }
    
    .confidence-high {
      color: #28a745;
      font-weight: 600;
    }
    
    .confidence-medium {
      color: #ffc107;
      font-weight: 600;
    }
    
    .confidence-low {
      color: #dc3545;
      font-weight: 600;
    }
    
    .root-causes-list {
      margin: 10px 0;
      padding-left: 20px;
    }
    
    .root-cause-item {
      margin: 5px 0;
      padding: 8px;
      background: #f8f9fa;
      border-left: 3px solid #3498db;
      border-radius: 3px;
    }
    
    .root-cause-category {
      display: inline-block;
      padding: 2px 8px;
      background: #3498db;
      color: white;
      border-radius: 3px;
      font-size: 0.8em;
      margin-right: 8px;
    }
    
    .workflow-section {
      margin: 40px 0;
      padding: 30px;
      background: #f8f9fa;
      border-radius: 8px;
      border: 1px solid #dee2e6;
    }
    
    .workflow-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    
    .workflow-title {
      font-size: 1.5em;
      color: #2c3e50;
      margin: 0;
    }
    
    .workflow-badge {
      background: #3498db;
      color: white;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 0.9em;
    }
    
    .no-data {
      text-align: center;
      padding: 40px;
      color: #7f8c8d;
      font-style: italic;
    }
    
    .footer {
      margin-top: 60px;
      padding-top: 20px;
      border-top: 2px solid #ecf0f1;
      text-align: center;
      color: #7f8c8d;
      font-size: 0.9em;
    }
    
    a {
      color: #3498db;
      text-decoration: none;
    }
    
    a:hover {
      text-decoration: underline;
    }
    
    .expandable {
      cursor: pointer;
    }
    
    .expandable-content {
      display: none;
      margin-top: 10px;
      padding: 15px;
      background: white;
      border-radius: 4px;
      border: 1px solid #dee2e6;
    }
    
    .expandable-content.expanded {
      display: block;
    }
    
    .expand-icon {
      display: inline-block;
      transition: transform 0.3s;
    }
    
    .expand-icon.expanded {
      transform: rotate(90deg);
    }
    
    @media print {
      body {
        background: white;
        padding: 0;
      }
      
      .container {
        box-shadow: none;
        padding: 20px;
      }
      
      .expandable-content {
        display: block !important;
      }
    }
    
    @media (max-width: 768px) {
      .container {
        padding: 20px;
      }
      
      h1 {
        font-size: 1.8em;
      }
      
      .summary-cards {
        grid-template-columns: 1fr;
      }
      
      table {
        font-size: 0.85em;
      }
      
      th, td {
        padding: 8px;
      }
    }
  </style>`;
}

/**
 * Build report header
 * @param {Object} options - Report options
 * @returns {string} HTML header
 */
function buildHeader(options) {
  const generatedDate = formatDateTime(new Date());
  const filters = [];

  if (options.workflows && options.workflows.length > 0) {
    filters.push(`Workflows: ${options.workflows.join(', ')}`);
  }
  if (options.branches && options.branches.length > 0) {
    filters.push(`Branches: ${options.branches.join(', ')}`);
  }
  if (options.startDate || options.endDate) {
    const dateRange = `${options.startDate || 'Beginning'} to ${options.endDate || 'Now'}`;
    filters.push(`Date Range: ${dateRange}`);
  }

  return `
    <h1>📊 Workflow Analysis Report</h1>
    <div class="header-info">
      <p><strong>Generated:</strong> ${generatedDate}</p>
      ${filters.length > 0 ? `<p><strong>Filters:</strong> ${filters.join(' | ')}</p>` : ''}
    </div>
  `;
}

/**
 * Build executive summary section
 * @param {Object} summary - Summary data
 * @returns {string} HTML content
 */
function buildExecutiveSummary(summary) {
  const successRate = formatPercentage(summary.successful_runs, summary.total_runs);
  const failureRate = formatPercentage(summary.failed_runs, summary.total_runs);

  return `
    <h2>Executive Summary</h2>
    <div class="summary-cards">
      <div class="card neutral">
        <div class="card-title">Total Runs</div>
        <div class="card-value">${summary.total_runs || 0}</div>
        <div class="card-subtitle">${summary.total_jobs || 0} jobs executed</div>
      </div>
      
      <div class="card success">
        <div class="card-title">Successful Runs</div>
        <div class="card-value">${summary.successful_runs || 0}</div>
        <div class="card-subtitle">${successRate} success rate</div>
      </div>
      
      <div class="card failure">
        <div class="card-title">Failed Runs</div>
        <div class="card-value">${summary.failed_runs || 0}</div>
        <div class="card-subtitle">${failureRate} failure rate</div>
      </div>
      
      <div class="card">
        <div class="card-title">Failed Steps</div>
        <div class="card-value">${summary.failed_steps || 0}</div>
        <div class="card-subtitle">Across ${summary.failed_jobs || 0} jobs</div>
      </div>
    </div>
  `;
}

/**
 * Build top root causes section
 * @param {Array} rootCauses - Root cause data
 * @returns {string} HTML content
 */
function buildTopRootCauses(rootCauses) {
  if (!rootCauses || rootCauses.length === 0) {
    return `
      <h2>🔍 Top Root Causes</h2>
      <div class="no-data">No root cause data available</div>
    `;
  }

  const rows = rootCauses.map((rc, index) => {
    const confidence = formatConfidence(rc.avg_confidence);
    const confidenceClass = rc.avg_confidence >= 0.8 ? 'confidence-high' :
                           rc.avg_confidence >= 0.6 ? 'confidence-medium' : 'confidence-low';

    return `
      <tr>
        <td>${index + 1}</td>
        <td><span class="root-cause-category">${escapeHtml(rc.category)}</span></td>
        <td><strong>${escapeHtml(rc.title)}</strong></td>
        <td>${rc.occurrence_count}</td>
        <td>${truncate(escapeHtml(rc.affected_jobs), 50)}</td>
        <td class="${confidenceClass}">${confidence}</td>
        <td>${escapeHtml(rc.suggested_fix || 'N/A')}</td>
      </tr>
    `;
  }).join('');

  return `
    <h2>🔍 Top Root Causes</h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Category</th>
          <th>Root Cause</th>
          <th>Occurrences</th>
          <th>Affected Jobs</th>
          <th>Avg Confidence</th>
          <th>Suggested Fix</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

/**
 * Build workflow breakdown section
 * @param {Array} workflowData - Workflow run data
 * @param {Array} stepFailures - Step failure data
 * @param {Object} options - Report options
 * @returns {string} HTML content
 */
function buildWorkflowBreakdown(workflowData, stepFailures, options) {
  if (!workflowData || workflowData.length === 0) {
    return `
      <h2>📋 Workflow Breakdown</h2>
      <div class="no-data">No workflow data available</div>
    `;
  }

  // Group by workflow and branch
  const grouped = {};
  workflowData.forEach(run => {
    const key = `${run.workflow_file_name}|${run.head_branch || 'unknown'}`;
    if (!grouped[key]) {
      grouped[key] = {
        workflow: run.workflow_file_name,
        branch: run.head_branch || 'unknown',
        runs: []
      };
    }
    grouped[key].runs.push(run);
  });

  const sections = Object.values(grouped).map(group => {
    return buildWorkflowSection(group, stepFailures);
  }).join('');

  return `
    <h2>📋 Workflow-Branch Breakdown</h2>
    ${sections}
  `;
}

/**
 * Build a single workflow section
 * @param {Object} group - Workflow group data
 * @param {Array} stepFailures - Step failure data
 * @returns {string} HTML content
 */
function buildWorkflowSection(group, stepFailures) {
  const runRows = group.runs.slice(0, 50).map(run => {
    const status = getStatusInfo(run.conclusion);
    const duration = formatDuration(run.created_at, run.updated_at);

    return `
      <tr>
        <td>#${run.run_number}</td>
        <td>${formatDateTime(run.created_at)}</td>
        <td><span class="status-badge ${status.class}">${status.emoji} ${status.text}</span></td>
        <td>${run.failed_jobs || 0} / ${run.total_jobs || 0}</td>
        <td>${run.failed_steps || 0}</td>
        <td>${duration}</td>
        <td><a href="${run.html_url}" target="_blank">View Run 🔗</a></td>
      </tr>
    `;
  }).join('');

  // Filter step failures for this workflow
  const relevantSteps = stepFailures.filter(step =>
    group.runs.some(run => run.run_id)
  );

  const stepRows = relevantSteps.slice(0, 20).map(step => {
    const rootCausesList = (step.root_causes || []).map(rc =>
      `<li class="root-cause-item">${escapeHtml(rc)}</li>`
    ).join('');

    return `
      <tr>
        <td><strong>${escapeHtml(step.step_name)}</strong><br><small>${escapeHtml(step.job_name)}</small></td>
        <td>${step.failure_count}</td>
        <td>${formatDateTime(step.last_failure)}</td>
        <td>
          ${rootCausesList ? `<ul class="root-causes-list">${rootCausesList}</ul>` : 'No root causes identified'}
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="workflow-section">
      <div class="workflow-header">
        <h3 class="workflow-title">${escapeHtml(group.workflow)} @ ${escapeHtml(group.branch)}</h3>
        <span class="workflow-badge">${group.runs.length} runs</span>
      </div>
      
      <h4>Recent Runs</h4>
      <table>
        <thead>
          <tr>
            <th>Run #</th>
            <th>Date & Time</th>
            <th>Status</th>
            <th>Failed Jobs</th>
            <th>Failed Steps</th>
            <th>Duration</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          ${runRows || '<tr><td colspan="7" class="no-data">No runs found</td></tr>'}
        </tbody>
      </table>
      
      ${stepRows ? `
        <h4>Step Failure Summary</h4>
        <table>
          <thead>
            <tr>
              <th>Step Name</th>
              <th>Failures</th>
              <th>Last Failure</th>
              <th>Root Causes</th>
            </tr>
          </thead>
          <tbody>
            ${stepRows}
          </tbody>
        </table>
      ` : ''}
    </div>
  `;
}

/**
 * Build report footer
 * @returns {string} HTML footer
 */
function buildFooter() {
  return `
    <div class="footer">
      <p>Generated by Log Processor Reporting Module</p>
      <p>Report generated on ${formatDateTime(new Date())}</p>
    </div>
  `;
}

/**
 * Get embedded JavaScript
 * @returns {string} Script tag with JS
 */
function getScripts() {
  return `<script>
    // Simple table sorting
    document.querySelectorAll('th').forEach((th, index) => {
      th.addEventListener('click', function() {
        const table = this.closest('table');
        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const isAscending = this.classList.contains('sort-asc');
        
        // Clear all sort indicators
        table.querySelectorAll('th').forEach(h => {
          h.classList.remove('sort-asc', 'sort-desc');
        });
        
        // Sort rows
        rows.sort((a, b) => {
          const aText = a.cells[index]?.textContent.trim() || '';
          const bText = b.cells[index]?.textContent.trim() || '';
          
          // Try numeric comparison
          const aNum = parseFloat(aText);
          const bNum = parseFloat(bText);
          
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return isAscending ? bNum - aNum : aNum - bNum;
          }
          
          // String comparison
          return isAscending ? 
            bText.localeCompare(aText) : 
            aText.localeCompare(bText);
        });
        
        // Update table
        rows.forEach(row => tbody.appendChild(row));
        
        // Update sort indicator
        this.classList.add(isAscending ? 'sort-desc' : 'sort-asc');
      });
    });
    
    console.log('Workflow Analysis Report loaded successfully');
  </script>`;
}

module.exports = {
  generateHTML,
};

