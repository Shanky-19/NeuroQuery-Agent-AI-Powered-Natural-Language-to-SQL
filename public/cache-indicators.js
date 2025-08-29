// Cache indicator functionality for the chatbot
// This will be included in the main HTML file

// Add cache indicator styles
const cacheStyles = `
.cache-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
    margin-left: 10px;
}

.cache-indicator.from-cache {
    background: #e8f5e8;
    color: #2e7d32;
    border: 1px solid #c8e6c9;
}

.cache-indicator.from-database {
    background: #fff3e0;
    color: #f57c00;
    border: 1px solid #ffcc02;
}

.cache-indicator.from-llm-cache {
    background: #f3e5f5;
    color: #7b1fa2;
    border: 1px solid #ce93d8;
}

.cache-indicator.fully-cached {
    background: #e1f5fe;
    color: #0277bd;
    border: 1px solid #81d4fa;
}

.cache-icon {
    width: 12px;
    height: 12px;
    border-radius: 50%;
}

.cache-icon.cached {
    background: #4caf50;
}

.cache-icon.fresh {
    background: #ff9800;
}

.cache-icon.llm-cached {
    background: #9c27b0;
}

.cache-icon.fully-cached {
    background: #2196f3;
}

.performance-info {
    background: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 6px;
    padding: 10px;
    margin: 10px 0;
    font-size: 13px;
    color: #6c757d;
}

.performance-metrics {
    display: flex;
    gap: 15px;
    flex-wrap: wrap;
}

.metric {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 80px;
}

.metric-value {
    font-weight: 600;
    color: #495057;
    font-size: 16px;
}

.metric-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.cache-tooltip {
    position: relative;
    cursor: help;
}

.cache-tooltip:hover::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: white;
    padding: 5px 8px;
    border-radius: 4px;
    font-size: 11px;
    white-space: nowrap;
    z-index: 1000;
}
`;

// Function to create cache indicator
function createCacheIndicator(isResultCached, isLLMCached) {
    let cacheClass, cacheText, iconClass, tooltip;
    
    if (isResultCached && isLLMCached) {
        cacheClass = 'fully-cached';
        cacheText = '⚡ Fully Cached';
        iconClass = 'fully-cached';
        tooltip = 'Both SQL generation and query results were served from cache';
    } else if (isResultCached) {
        cacheClass = 'from-cache';
        cacheText = '🗄️ Results Cached';
        iconClass = 'cached';
        tooltip = 'Query results were served from cache';
    } else if (isLLMCached) {
        cacheClass = 'from-llm-cache';
        cacheText = '🧠 SQL Cached';
        iconClass = 'llm-cached';
        tooltip = 'SQL was generated from cache, but results are fresh from database';
    } else {
        cacheClass = 'from-database';
        cacheText = '🔄 Fresh Query';
        iconClass = 'fresh';
        tooltip = 'Both SQL generation and query execution were performed fresh';
    }
    
    return `<span class="cache-indicator ${cacheClass} cache-tooltip" data-tooltip="${tooltip}">
        <span class="cache-icon ${iconClass}"></span>
        ${cacheText}
    </span>`;
}

// Function to create performance info
function createPerformanceInfo(metadata, isResultCached, isLLMCached) {
    const performanceDiv = document.createElement('div');
    performanceDiv.className = 'performance-info';
    
    const executionTime = metadata.executionTime || 0;
    const rowCount = metadata.rowCount || 0;
    
    // Calculate performance benefits
    let performanceNote = '';
    if (isResultCached && isLLMCached) {
        performanceNote = '⚡ Ultra-fast response - served entirely from cache';
    } else if (isResultCached) {
        performanceNote = '🚀 Fast response - results from cache';
    } else if (isLLMCached) {
        performanceNote = '🧠 SQL generation accelerated by cache';
    } else {
        performanceNote = '🔄 Fresh execution - results may be cached for future queries';
    }
    
    performanceDiv.innerHTML = `
        <div style="margin-bottom: 8px; font-weight: 500; color: #495057;">
            ${performanceNote}
        </div>
        <div class="performance-metrics">
            <div class="metric">
                <div class="metric-value">${executionTime}ms</div>
                <div class="metric-label">Execution Time</div>
            </div>
            <div class="metric">
                <div class="metric-value">${rowCount}</div>
                <div class="metric-label">Rows Returned</div>
            </div>
            <div class="metric">
                <div class="metric-value">${isResultCached ? 'Cached' : 'Fresh'}</div>
                <div class="metric-label">Data Source</div>
            </div>
            ${metadata.fields ? `
            <div class="metric">
                <div class="metric-value">${metadata.fields.length}</div>
                <div class="metric-label">Columns</div>
            </div>
            ` : ''}
        </div>
    `;
    
    return performanceDiv;
}

// Export functions for use in main application
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        cacheStyles,
        createCacheIndicator,
        createPerformanceInfo
    };
}